"""Smoke tests for the automation dashboard.

    python tests/smoke.py
    python tests/smoke.py --live
"""
import base64
import csv
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import create_app  # noqa: E402
from app.catalog import annotated  # noqa: E402
from app.clock import ET, freeze, unfreeze  # noqa: E402
from app.month_end import K13, K14  # noqa: E402

FROZEN = datetime(2026, 10, 10, 16, 0, tzinfo=ET)
PASSWORD = "x"
SECRET = "y"
TOKEN = "z"


def config(data, demo=False):
    return {
        "DATA_DIR": data,
        "DASHBOARD_PASSWORD": PASSWORD,
        "SESSION_SECRET": SECRET,
        "INGEST_TOKEN": TOKEN,
        "DEMO_SEED": demo,
    }


class DashboardSmoke(unittest.TestCase):
    def setUp(self):
        freeze(FROZEN)
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app(config(self.tmp.name))
        self.client = self.app.test_client()

    def tearDown(self):
        unfreeze()
        self.tmp.cleanup()

    def login(self, client=None, password=PASSWORD):
        client = client or self.client
        return client.post("/login", data={"password": password, "next": "/"}, follow_redirects=False)

    def authed(self):
        self.login()
        return self.client

    def test_descriptions_and_run_details(self):
        h = {"Authorization": "Bearer " + TOKEN}
        r = self.client.get("/api/ingest/month-end/description?id=ME-029", headers=h)
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        self.assertEqual(r.get_json()["description"]["source"], "seed")
        r = self.client.post("/api/ingest/month-end/description", json={"id": "ME-029", "description": "New text"}, headers=h)
        self.assertEqual(r.get_json()["description"]["text"], "New text")
        r = self.client.post("/api/ingest/month-end/description", json={"id": "ME-029", "description": ""}, headers=h)
        self.assertEqual(r.get_json()["description"]["source"], "seed")
        r = self.client.post("/api/ingest/month-end/run-detail", json={"id": "ME-029", "month": "2026-10", "summary": "S", "details": "D", "facts": [{"label": "BP", "value": "6120"}]}, headers=h)
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        self.assertEqual(r.get_json()["run"]["run_id"], "ME-029-2026-10")
        self.assertEqual(self.client.post("/api/ingest/month-end/run-detail", json={"id": "ME-029", "month": "bad"}, headers=h).status_code, 400)
        self.assertEqual(self.client.post("/api/ingest/month-end/run-detail", json={"id": "ME-029"}).status_code, 401)
        page = self.authed().get("/api/monthend").get_json()
        task = next(t for t in page["tasks"] if t["me_id"] == "ME-029")
        self.assertEqual(task["run_details"][0]["summary"], "S")
        self.assertIn("text", task["description"])
        r = self.client.delete("/api/ingest/month-end/run-detail?id=ME-029&run_id=ME-029-2026-10", headers=h)
        self.assertEqual(r.status_code, 200)

    def test_sheet_date_beats_later_run_completion(self):
        from app.month_end import decorate
        payload = {"tasks": [{"key": "k", "months": {"October": {"kind": "done", "text": "10/6"}, "November": {"kind": "open", "text": "Open"}}}], "removed": []}
        recs = [{"task_key": "k", "status": "succeeded", "id": "r1", "log_month": "October", "done_date": "2026-10-11", "created_at": "2026-10-11T09:00:00-04:00"},
                {"task_key": "k", "status": "succeeded", "id": "r2", "log_month": "November", "done_date": "2026-11-03", "created_at": "2026-11-03T09:00:00-04:00"}]
        out = decorate(payload, recs)["tasks"][0]
        self.assertEqual(out["months"]["October"]["text"], "10/6")
        self.assertEqual(out["completion"]["October"]["date"], "2026-10-06")
        self.assertEqual(out["months"]["November"]["text"], "11/3")

    def test_panel_month_table_has_no_duplicate_sheet_label(self):
        page = self.authed().get("/").get_data(as_text=True)
        self.assertIn("c.source!=='sheet'", page)
        self.assertNotIn("${c.source?esc(c.source):''}${cell?' · sheet '", page)

    def test_healthz_is_public(self):
        res = self.client.get("/healthz")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json(), {"ok": True})

    def test_pages_and_api_require_login(self):
        self.assertEqual(self.client.get("/").status_code, 302)
        self.assertIn("/login", self.client.get("/").headers["Location"])
        self.assertEqual(self.client.get("/api/runs").status_code, 401)
        self.assertEqual(self.client.get("/api/automations").status_code, 401)
        self.assertEqual(self.client.get("/api/monthend").status_code, 401)
        self.assertEqual(self.client.get("/api/settings").status_code, 401)
        self.assertEqual(self.client.post("/api/monthend/sync").status_code, 401)
        self.assertEqual(self.client.post("/api/monthend/completion", json={}).status_code, 401)
        self.assertEqual(self.client.post("/api/monthend/automation", json={}).status_code, 401)
        self.assertEqual(self.client.post("/api/ingest/month-end/status", json={}).status_code, 401)
        self.assertEqual(self.client.post("/api/ingest/month-end/automation", json={}).status_code, 401)
        self.assertEqual(self.client.get("/api/ingest/month-end/tasks").status_code, 401)
        self.assertEqual(self.client.post("/api/ingest/month-end/link", json={}).status_code, 401)
        self.assertEqual(self.client.post("/api/monthend/link", json={}).status_code, 401)
        self.assertEqual(self.client.post("/api/monthend/link/dismiss", json={}).status_code, 401)
        self.assertEqual(self.client.post("/api/ingest/month-end/link/dismiss", json={}).status_code, 401)
        self.assertEqual(self.client.post("/api/ingest/month-end/attachment").status_code, 401)
        self.assertEqual(self.client.get("/api/ingest/month-end/attachments").status_code, 401)
        self.assertEqual(self.client.get("/api/monthend/attachments/abc").status_code, 401)
        self.assertEqual(self.client.delete("/api/monthend/attachments/abc").status_code, 401)
        self.assertEqual(self.client.get("/api/ingest/month-end/writebacks").status_code, 401)
        self.assertEqual(self.client.post("/api/ingest/month-end/writebacks/abc/result", json={}).status_code, 401)
        self.assertEqual(self.client.get("/vehicle-lease").status_code, 302)
        self.assertEqual(self.client.get("/api/vehicle-lease").status_code, 401)
        self.assertEqual(self.client.get("/api/ingest/vehicle-lease/registry").status_code, 401)
        self.assertEqual(self.client.post("/api/ingest/vehicle-lease/registry", json={}).status_code, 401)
        self.assertEqual(self.client.patch("/api/ingest/vehicle-lease/registry/55", json={}).status_code, 401)
        self.assertEqual(self.client.delete("/api/ingest/vehicle-lease/registry/55").status_code, 401)
        self.assertEqual(self.client.get("/api/ingest/vehicle-lease/ignored").status_code, 401)
        self.assertEqual(self.client.post("/api/ingest/vehicle-lease/ignored", json={}).status_code, 401)
        self.assertEqual(self.client.delete("/api/ingest/vehicle-lease/ignored/55").status_code, 401)
        self.assertEqual(self.client.post("/api/ingest/vehicle-lease/runs").status_code, 401)
        self.assertEqual(self.client.patch("/api/ingest/vehicle-lease/runs/2026-09").status_code, 401)
        self.assertEqual(self.client.post("/api/ingest/runs", json={}).status_code, 401)
        bad = self.login(password="nope")
        self.assertEqual(bad.status_code, 401)
        self.assertIn(b"Wrong password", bad.data)

    def test_login_and_three_views(self):
        res = self.login()
        self.assertEqual(res.status_code, 302)
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        body = page.get_data(as_text=True)
        self.assertIn("Today / Daily runs", body)
        self.assertIn("All automations", body)
        self.assertIn("On demand", body)
        self.assertIn('id="dailyView"', body)
        self.assertIn('id="allView"', body)
        self.assertIn('id="odView"', body)
        self.assertNotIn("__DASH_JSON__", body)
        self.assertIn("localStorage.getItem('monthend.hideFinished')", body)
        self.assertEqual(body.count("localStorage"), 2)
        autos = self.client.get("/api/automations").get_json()
        self.assertEqual(len(autos["automations"]), 30)
        runs = self.client.get("/api/runs?date=2026-10-10").get_json()
        self.assertEqual(runs["state"], "today")
        self.assertTrue(runs["summary"]["scheduled"] > 0)
        month = self.client.get("/api/monthend").get_json()
        self.assertGreater(month["luke_count"], 0)
        self.assertTrue(any(t["ladder"] == "ready" for t in month["tasks"]))

    def test_active_catalog_has_a_schedule(self):
        for auto in annotated():
            if auto["status"] == "active":
                self.assertNotEqual(auto["schedule"].get("kind"), "none", auto["id"])

    def test_saturday_board_is_honest_without_demo_seed(self):
        self.authed()
        board = self.client.get("/api/runs?date=2026-10-10").get_json()
        sched = [r for r in board["rows"] if r["kind"] == "schedule"]
        self.assertEqual(
            {r["id"] for r in sched},
            {
                "time-edit-state-backup-before-nightly-deploy",
                "nightly-fullbay-clock-ins-time-edit-app",
                "morning-time-edit-ready-operations-managers",
                "time-edit-restore-sign-offs-after-nightly-deploy",
                "primary-inbox-triage",
            },
        )
        triage = next(r for r in sched if r["id"] == "primary-inbox-triage")
        self.assertEqual(triage["time"], "All day")
        self.assertEqual(triage["ran"], "pending")
        self.assertEqual(triage["result"], "No report yet")
        missed = [r for r in sched if r["id"] != "primary-inbox-triage"]
        self.assertTrue(all(r["ran"] == "missed" and r["result"] == "Missed" for r in missed))
        self.assertEqual(len(board["weekend"]), 13)
        self.assertTrue(all(r["ran"] == "ns" for r in board["weekend"]))
        blob = json.dumps(board)
        self.assertNotIn("71 vendors", blob)
        past = self.client.get("/api/runs?date=2026-10-09").get_json()
        self.assertNotIn("71 vendors", json.dumps(past))
        self.assertTrue(all(r["result"] == "Missed" for r in past["rows"] if r["kind"] == "schedule"))
        monday = self.client.get("/api/runs?date=2026-10-12").get_json()
        ids = {r["id"] for r in monday["rows"]}
        self.assertIn("linkedin-weekly-drafts", ids)
        self.assertIn("new-qbo-vendors-slack-angie", ids)
        self.assertNotIn("linkedin-weekly-post-check", ids)
        self.assertTrue(all(r["ran"] == "pending" for r in monday["rows"] if r["kind"] == "schedule"))

    def test_ingested_run_shows_on_the_board(self):
        self.authed()
        denied = self.client.post("/api/ingest/runs", json={"automation_id": "x"})
        self.assertEqual(denied.status_code, 401)
        res = self.client.post(
            "/api/ingest/runs",
            json={
                "bot": "Time Edit Project",
                "automation_id": "time-edit-state-backup-before-nightly-deploy",
                "timestamp": "2026-10-10T02:50:00-04:00",
                "status": "ok",
                "summary": "Snapshot saved",
            },
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
        board = self.client.get("/api/runs?date=2026-10-10").get_json()
        row = next(r for r in board["rows"] if r["id"] == "time-edit-state-backup-before-nightly-deploy")
        self.assertEqual(row["ran"], "yes")
        self.assertEqual(row["outcome"], "ok")
        self.assertEqual(row["result"], "Snapshot saved")
        self.assertEqual(row["actual"], "2:50 AM")
        unknown = self.client.post(
            "/api/ingest/runs",
            json={"automation_id": "not-a-real-bot", "timestamp": "2026-10-10T02:50:00-04:00", "status": "ok", "summary": "x"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(unknown.status_code, 400)

    def test_run_now_round_trip_and_qbo_approval(self):
        self.authed()
        month = self.client.get("/api/monthend").get_json()
        payroll = next(t for t in month["tasks"] if t["key"] == K13)
        je = next(t for t in month["tasks"] if t["key"] == K14)
        self.assertEqual(payroll["ladder"], "ready")
        self.assertEqual(payroll["automation"], "Run Now- Ready")
        self.assertFalse(payroll["qbo_write"])
        self.assertTrue(je["qbo_write"])
        payload = base64.b64encode(b"payroll-bytes").decode()
        queued = self.client.post("/api/monthend/run", json={
            "key": K13,
            "month": "November",
            "run_note": "use the september export",
            "files": [{
                "name": "bamboo.xlsx",
                "type": "application/vnd.ms-excel",
                "size": 13,
                "need": payroll["files"]["needs"][0]["name"],
                "file_note": "month to date",
                "data_b64": payload,
            }],
        })
        self.assertEqual(queued.status_code, 200, queued.get_data(as_text=True))
        body = queued.get_json()
        rid = body["id"]
        task = next(t for t in body["monthend"]["tasks"] if t["key"] == K13)
        self.assertEqual(task["open_request"]["state"], "queued")
        self.assertIn("November", [m for m, cell in task["months"].items() if cell["kind"] == "open"])
        pending = self.client.get("/api/ingest/run-requests", headers={"Authorization": f"Bearer {TOKEN}"}).get_json()
        self.assertEqual([r["id"] for r in pending["requests"]], [rid])
        self.assertEqual(pending["requests"][0]["run_note"], "use the september export")
        self.assertEqual(pending["requests"][0]["files"][0]["name"], "bamboo.xlsx")
        download = self.client.get(pending["requests"][0]["files"][0]["download_path"], headers={"Authorization": f"Bearer {TOKEN}"})
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.data, b"payroll-bytes")
        done = self.client.post(
            f"/api/ingest/run-requests/{rid}/complete",
            json={"status": "succeeded", "notes": "Filled B6:G34", "done_date": "2026-10-10"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(done.status_code, 200, done.get_data(as_text=True))
        month = self.client.get("/api/monthend").get_json()
        task = next(t for t in month["tasks"] if t["key"] == K13)
        self.assertIsNone(task["open_request"])
        self.assertEqual(task["months"]["November"], {"kind": "done", "text": "10/10"})
        self.assertEqual(task["completion"]["November"]["status"], "done")
        self.assertEqual(task["completion"]["November"]["source"], "run")
        self.assertEqual(task["completion"]["November"]["date"], "2026-10-10")
        board = self.client.get("/api/runs?date=2026-10-10").get_json()
        self.assertTrue(any(r["key"] == rid and r["ran"] == "yes" for r in board["rows"]))
        self.assertEqual(self.client.get("/api/ingest/run-requests", headers={"Authorization": f"Bearer {TOKEN}"}).get_json()["requests"], [])

        qbo = self.client.post("/api/monthend/run", json={"key": K14, "month": "November", "run_note": "please post the JE"})
        qid = qbo.get_json()["id"]
        early = self.client.post(f"/api/monthend/requests/{qid}/decision", json={"approve": True})
        self.assertEqual(early.status_code, 409)
        held = self.client.post(
            f"/api/ingest/run-requests/{qid}/complete",
            json={"status": "succeeded", "notes": "JE ready", "done_date": "2026-10-10"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(held.status_code, 200)
        self.assertTrue(held.get_json()["held_for_approval"])
        self.assertEqual(held.get_json()["request"]["status"], "awaiting_approval")
        month = self.client.get("/api/monthend").get_json()
        je_task = next(t for t in month["tasks"] if t["key"] == K14)
        self.assertEqual(je_task["open_request"]["state"], "awaiting")
        self.assertEqual(je_task["months"]["November"]["kind"], "open")
        self.assertEqual(je_task["completion"]["November"]["status"], "in_progress")
        self.assertEqual(je_task["completion"]["November"]["source"], "run")
        approved = self.client.post(f"/api/monthend/requests/{qid}/decision", json={"approve": True})
        self.assertEqual(approved.status_code, 200)
        still = self.client.get("/api/ingest/run-requests", headers={"Authorization": f"Bearer {TOKEN}"}).get_json()
        self.assertEqual(still["requests"][0]["status"], "approved")
        self.assertTrue(still["requests"][0]["approved"])
        final = self.client.post(
            f"/api/ingest/run-requests/{qid}/complete",
            json={"status": "succeeded", "notes": "Posted after approval", "done_date": "2026-10-10"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(final.status_code, 200)
        self.assertEqual(final.get_json()["request"]["status"], "succeeded")
        month = self.client.get("/api/monthend").get_json()
        je_task = next(t for t in month["tasks"] if t["key"] == K14)
        self.assertEqual(je_task["months"]["November"], {"kind": "done", "text": "10/10"})
        self.assertEqual(je_task["completion"]["November"]["status"], "done")
        self.assertEqual(je_task["completion"]["November"]["source"], "run")

    def test_notes_and_status_survive_a_new_process_store(self):
        self.authed()
        month = self.client.get("/api/monthend").get_json()
        task = next(t for t in month["tasks"] if t["key"] == K13)
        saved = self.client.post("/api/monthend/note", json={"key": task["key"], "text": "Always use the month-to-date export"})
        self.assertEqual(saved.status_code, 200)
        self.client.post("/api/monthend/filenote", json={
            "key": task["key"], "name": task["files"]["needs"][0]["name"], "text": "Amber pulls this",
        })
        self.client.post("/api/command", json={"id": "remind-change-dext-subscription", "action": "pause"})
        app2 = create_app(config(self.tmp.name))
        client2 = app2.test_client()
        client2.post("/login", data={"password": PASSWORD})
        month2 = client2.get("/api/monthend").get_json()
        task2 = next(t for t in month2["tasks"] if t["key"] == K13)
        self.assertEqual(task2["note"]["text"], "Always use the month-to-date export")
        self.assertEqual(task2["files"]["needs"][0]["note"]["text"], "Amber pulls this")
        autos = client2.get("/api/automations").get_json()["automations"]
        dext = next(a for a in autos if a["id"] == "remind-change-dext-subscription")
        self.assertEqual(dext["status"], "paused")
        self.assertIsNone(dext["next_run"])

    def test_sheet_snapshot_syncs_by_task_and_due(self):
        self.authed()
        first = self.client.get("/api/monthend").get_json()
        second = self.client.get("/api/monthend").get_json()
        self.assertEqual(first["last_synced"], second["last_synced"])
        self.assertEqual(first["snapshot_id"], second["snapshot_id"])
        self.assertTrue(first["snapshot_id"])
        seed = (ROOT / "seed" / "month_end_2026.csv").read_text(encoding="utf-8")
        rows = list(csv.reader(io.StringIO(seed)))
        header, data = rows[0], rows[1:]
        removed_name = " ".join(data[0][3].split())
        data = data[1:]
        data.append(["1st week", "", "Test", "Brand New Checklist Line", "from the bot", "Luke", *([""] * 12)])
        buf = io.StringIO()
        csv.writer(buf).writerows([header, *data])
        res = self.client.post(
            "/api/ingest/month-end",
            data=buf.getvalue(),
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "text/csv"},
        )
        self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
        changes = res.get_json()["changes"]
        self.assertIn("Brand New Checklist Line", changes["added"])
        self.assertIn(removed_name, changes["removed"])
        month = self.client.get("/api/monthend").get_json()
        new = next(t for t in month["tasks"] if t["task"] == "Brand New Checklist Line")
        self.assertTrue(new["new"])
        self.assertEqual(new["ladder"], "manual")
        self.assertEqual(new["automation"], "New")
        self.assertIsNone(new["candidate"])
        self.assertEqual(new["assigned"], "Luke")
        self.assertTrue(any(t["task"] == removed_name for t in month["removed"]))
        self.assertIn("Brand New Checklist Line", month["changes"]["added"])
        self.assertNotEqual(month["snapshot_id"], first["snapshot_id"])
        self.assertNotEqual(month["last_synced"], first["last_synced"])
        again = self.client.get("/api/monthend").get_json()
        self.assertEqual(again["last_synced"], month["last_synced"])
        self.assertEqual(again["snapshot_id"], month["snapshot_id"])

    def test_snapshot_refuses_empty_sheet_and_majority_removal(self):
        self.authed()
        before = self.client.get("/api/monthend").get_json()
        self.assertGreater(len(before["tasks"]), 2)
        data_dir = Path(self.tmp.name)
        sheet_path = data_dir / "month_end_2026.csv"
        registry_path = data_dir / "month_end_registry.json"
        sheet_bytes = sheet_path.read_bytes()
        registry_bytes = registry_path.read_bytes()
        snaps = data_dir / "sheet_snapshots"
        seed = (ROOT / "seed" / "month_end_2026.csv").read_text(encoding="utf-8")
        header = seed.splitlines()[0]
        headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "text/csv"}

        empty = header + "\n,,,,,\n"
        refused = self.client.post("/api/ingest/month-end", data=empty, headers=headers)
        self.assertEqual(refused.status_code, 400, refused.get_data(as_text=True))
        self.assertIn("no task rows", refused.get_json()["error"])
        self.assertIn("force=1", refused.get_json()["error"])

        rows = list(csv.reader(io.StringIO(seed)))
        buf = io.StringIO()
        csv.writer(buf).writerows([rows[0], rows[1]])
        majority = self.client.post("/api/ingest/month-end", data=buf.getvalue(), headers=headers)
        self.assertEqual(majority.status_code, 400, majority.get_data(as_text=True))
        self.assertIn("would remove", majority.get_json()["error"])
        self.assertIn(str(len(before["tasks"]) - 1), majority.get_json()["error"])

        still = self.client.post("/api/ingest/month-end?force=0", data=empty, headers=headers)
        self.assertEqual(still.status_code, 400, still.get_data(as_text=True))
        self.assertEqual(sheet_path.read_bytes(), sheet_bytes)
        self.assertEqual(registry_path.read_bytes(), registry_bytes)
        self.assertEqual(list(snaps.glob("*.csv")), [])
        after = self.client.get("/api/monthend").get_json()
        self.assertEqual(after["snapshot_id"], before["snapshot_id"])
        self.assertEqual(len(after["tasks"]), len(before["tasks"]))
        self.assertEqual(len(after["removed"]), len(before["removed"]))
        self.assertEqual([t["task"] for t in after["tasks"]], [t["task"] for t in before["tasks"]])

        forced = self.client.post("/api/ingest/month-end?force=1", data=empty, headers=headers)
        self.assertEqual(forced.status_code, 200, forced.get_data(as_text=True))
        wiped = self.client.get("/api/monthend").get_json()
        self.assertEqual(wiped["tasks"], [])
        self.assertGreaterEqual(len(wiped["removed"]), len(before["tasks"]))
        self.assertNotEqual(wiped["snapshot_id"], before["snapshot_id"])

    def _webhook_server(self, status=204):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                self.server.got_body = self.rfile.read(n)
                self.server.got_headers = {k.lower(): v for k, v in self.headers.items()}
                self.send_response(status)
                self.end_headers()

            def log_message(self, fmt, *args):
                return

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        httpd.got_body = b""
        httpd.got_headers = {}
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(httpd.shutdown)
        self.addCleanup(httpd.server_close)
        return httpd

    def test_sync_now_posts_webhook_and_masks_the_key(self):
        httpd = self._webhook_server()
        secret = "sync-key-9f3a"
        url = f"http://127.0.0.1:{httpd.server_address[1]}/hook"
        self.authed()
        missing = self.client.post("/api/monthend/sync")
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.get_json()["error"], "no_webhook")
        bad_url = self.client.post("/api/settings", json={"sync_webhook_url": "javascript:alert(1)"})
        self.assertEqual(bad_url.status_code, 400)

        saved = self.client.post("/api/settings", json={"sync_webhook_url": url, "sync_webhook_key": secret})
        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        shown = self.client.get("/api/settings")
        self.assertNotIn(secret, shown.get_data(as_text=True))
        payload = shown.get_json()
        self.assertEqual(payload["sync_webhook_url"], url)
        self.assertEqual(payload["sync_webhook_key_mask"], "••••9f3a")
        self.assertEqual(payload["key_source"], "saved")
        kept = self.client.post("/api/settings", json={"sync_webhook_url": url, "sync_webhook_key": ""})
        self.assertEqual(kept.get_json()["settings"]["sync_webhook_key_mask"], "••••9f3a")

        before = self.client.get("/api/monthend").get_json()
        res = self.client.post("/api/monthend/sync")
        self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
        body = res.get_json()
        self.assertTrue(body["requested"])
        self.assertIn("about a minute", body["message"])
        self.assertEqual(body["last_synced"], before["last_synced"])
        sent = json.loads(httpd.got_body)
        self.assertEqual(sent["source"], "automation-dashboard")
        self.assertEqual(sent["action"], "month-end-sync")
        self.assertTrue(sent["requested_at"])
        self.assertEqual(httpd.got_headers.get("authorization"), f"Bearer {secret}")
        self.assertEqual(httpd.got_headers.get("x-webhook-key"), secret)
        self.assertEqual(httpd.got_headers.get("x-api-key"), secret)
        page = self.client.get("/").get_data(as_text=True)
        self.assertIn("Sync webhook URL", page)
        self.assertIn("Last synced from sheet:", page)
        self.assertNotIn(secret, page)

    def test_sync_webhook_failure_reports_status(self):
        httpd = self._webhook_server(status=418)
        self.authed()
        self.client.post("/api/settings", json={
            "sync_webhook_url": f"http://127.0.0.1:{httpd.server_address[1]}/hook",
            "sync_webhook_key": "k",
        })
        res = self.client.post("/api/monthend/sync")
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.get_json()["status"], 418)
        import socket
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        closed = sock.getsockname()[1]
        sock.close()
        down = self.client.post("/api/settings", json={"sync_webhook_url": f"http://127.0.0.1:{closed}/hook"})
        self.assertEqual(down.status_code, 200)
        failed = self.client.post("/api/monthend/sync")
        self.assertEqual(failed.status_code, 502)
        self.assertIsNone(failed.get_json()["status"])

    def test_sync_webhook_env_fallback(self):
        httpd = self._webhook_server()
        secret = "env-secret-zz99"
        cfg = config(self.tmp.name + "-env")
        cfg["SYNC_WEBHOOK_URL"] = f"http://127.0.0.1:{httpd.server_address[1]}/hook"
        cfg["SYNC_WEBHOOK_KEY"] = secret
        client = create_app(cfg).test_client()
        client.post("/login", data={"password": PASSWORD})
        res = client.post("/api/monthend/sync")
        self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
        self.assertEqual(httpd.got_headers.get("authorization"), f"Bearer {secret}")
        shown = client.get("/api/settings")
        self.assertNotIn(secret, shown.get_data(as_text=True))
        payload = shown.get_json()
        self.assertEqual(payload["url_source"], "env")
        self.assertEqual(payload["key_source"], "env")
        self.assertEqual(payload["sync_webhook_key_mask"], "••••zz99")

    def test_month_status_sheet_manual_bot_and_week_collapse(self):
        self.authed()
        page = self.client.get("/").get_data(as_text=True)
        self.assertIn("This month", page)
        self.assertIn("Skipped / N/A", page)
        self.assertIn("Mark done", page)
        self.assertIn("Run Now- Ready", page)
        self.assertIn("saveAuto", page)
        self.assertIn("kept when the sheet syncs", page)
        self.assertNotIn("odProgText", page)
        self.assertIn("How to automate this", page)
        self.assertIn("grokbot://app/v1/agent?id=5061c392-f770-44b7-835a-85eba2d15217", page)
        self.assertIn("Teach you ", page)
        self.assertIn("comment on the Notes cell", page)
        self.assertIn("copyMeId", page)
        self.assertIn("linkRemoved", page)
        self.assertIn("dismissLink", page)
        self.assertIn("Link to removed task…", page)
        self.assertIn("Hide Finished Tasks", page)
        self.assertIn("setHideFinished", page)
        self.assertIn("monthend.hideFinished", page)
        self.assertIn("done hidden", page)
        self.assertIn("openAtt", page)
        self.assertIn("deleteAttachment", page)
        self.assertIn("thumbbtn", page)
        self.assertIn("Couldn't write to sheet", page)
        self.assertIn("writeWarn", page)
        self.assertIn("leaseLink", page)
        self.assertIn('href="/vehicle-lease"', page)
        self.assertNotIn("Candidate", page)
        self.assertNotIn("Being built", page)
        month = self.client.get("/api/monthend").get_json()
        former = next(t for t in month["tasks"] if t["task"] == "Run SalesPeople Commissions")
        self.assertEqual(former["automation"], "Manual")
        self.assertIsNone(former["candidate"])
        self.assertIsNone(former["bot"])
        ready = [t["automation"] for t in month["tasks"]]
        self.assertEqual(set(ready), {"Manual", "Run Now- Ready"})
        cot = next(t for t in month["tasks"] if t["task"] == "Prep COT & Send to Sheldon")
        self.assertEqual(cot["due_norm"], "1st week")
        self.assertEqual(cot["due_label"], "1st week")
        self.assertEqual(cot["completion"]["October"]["status"], "done")
        self.assertEqual(cot["completion"]["October"]["source"], "sheet")
        self.assertEqual(cot["completion"]["October"]["text"], "10/6")
        self.assertEqual(cot["completion"]["October"]["date"], "2026-10-06")
        bonuses = next(t for t in month["tasks"] if t["task"].startswith("Review Tech Bonuses"))
        self.assertEqual(bonuses["completion"]["October"]["status"], "not_started")
        self.assertEqual(bonuses["months"]["October"]["kind"], "open")
        ar = next(t for t in month["tasks"] if t["task"] == "Check Service Leasing AR")
        self.assertEqual(ar["completion"]["January"]["status"], "skipped")
        self.assertEqual(ar["completion"]["January"]["source"], "sheet")
        vendor = next(t for t in month["tasks"] if t["task"].startswith("Create JE for Negotiated"))
        self.assertEqual(vendor["months"]["May"]["text"], "530")
        self.assertEqual(vendor["completion"]["May"]["status"], "not_started")
        self.assertEqual(vendor["completion"]["October"]["status"], "done")

        marked = self.client.post("/api/monthend/completion", json={
            "key": bonuses["key"],
            "month": "October",
            "status": "done",
            "date": "2026-10-11",
            "note": "did it in the office",
        })
        self.assertEqual(marked.status_code, 200, marked.get_data(as_text=True))
        saved = next(t for t in marked.get_json()["monthend"]["tasks"] if t["key"] == bonuses["key"])
        self.assertEqual(saved["completion"]["October"]["status"], "done")
        self.assertEqual(saved["completion"]["October"]["source"], "manual")
        self.assertEqual(saved["completion"]["October"]["text"], "10/11")
        self.assertEqual(saved["completion"]["October"]["note"], "did it in the office")
        self.assertEqual(saved["months"]["October"]["kind"], "open")
        forced = self.client.post("/api/monthend/completion", json={
            "key": cot["key"], "month": "October", "status": "not_started",
        })
        self.assertEqual(
            next(t for t in forced.get_json()["monthend"]["tasks"] if t["key"] == cot["key"])["completion"]["October"]["status"],
            "not_started",
        )
        cleared = self.client.post("/api/monthend/completion", json={
            "key": cot["key"], "month": "October", "status": "auto",
        })
        self.assertEqual(
            next(t for t in cleared.get_json()["monthend"]["tasks"] if t["key"] == cot["key"])["completion"]["October"]["source"],
            "sheet",
        )

        denied = self.client.post("/api/ingest/month-end/status", json={
            "task": bonuses["task"], "due": "1st Week", "status": "skipped",
        })
        self.assertEqual(denied.status_code, 401)
        bot = self.client.post(
            "/api/ingest/month-end/status",
            json={"task": bonuses["task"], "due": "1st Week", "month": "November", "status": "in_progress", "note": "bot started it"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(bot.status_code, 200, bot.get_data(as_text=True))
        self.assertEqual(bot.get_json()["completion"]["status"], "in_progress")
        self.assertEqual(bot.get_json()["completion"]["source"], "bot")
        missing = self.client.post(
            "/api/ingest/month-end/status",
            json={"task": "Not a real line", "due": "1st week", "status": "done"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(missing.status_code, 404)
        bad = self.client.post("/api/monthend/completion", json={"key": bonuses["key"], "month": "Oct", "status": "done"})
        self.assertEqual(bad.status_code, 400)

        folded = self.client.post("/api/monthend/weeks", json={"due": "1st Week", "collapsed": True})
        self.assertEqual(folded.status_code, 200)
        self.assertTrue(folded.get_json()["week_collapsed"]["1st week"])
        opened = self.client.post("/api/monthend/weeks", json={"due": "2nd week", "collapsed": False})
        self.assertFalse(opened.get_json()["week_collapsed"]["2nd week"])

        app2 = create_app(config(self.tmp.name))
        client2 = app2.test_client()
        client2.post("/login", data={"password": PASSWORD})
        again = client2.get("/api/monthend").get_json()
        self.assertTrue(again["week_collapsed"]["1st week"])
        self.assertFalse(again["week_collapsed"]["2nd week"])
        kept = next(t for t in again["tasks"] if t["key"] == bonuses["key"])
        self.assertEqual(kept["completion"]["October"]["note"], "did it in the office")
        self.assertEqual(kept["completion"]["November"]["source"], "bot")
        self.assertEqual(kept["months"]["October"]["kind"], "open")

    def test_automation_badge_can_be_set_and_survives_sync(self):
        self.authed()
        month = self.client.get("/api/monthend").get_json()
        commissions = next(t for t in month["tasks"] if t["task"] == "Run SalesPeople Commissions")
        payroll = next(t for t in month["tasks"] if t["key"] == K13)
        self.assertEqual(commissions["automation"], "Manual")
        self.assertEqual(payroll["automation"], "Run Now- Ready")

        switched = self.client.post("/api/monthend/automation", json={
            "key": commissions["key"], "automation": "run now ready",
        })
        self.assertEqual(switched.status_code, 200, switched.get_data(as_text=True))
        task = next(t for t in switched.get_json()["monthend"]["tasks"] if t["key"] == commissions["key"])
        self.assertEqual(task["automation"], "Run Now- Ready")
        self.assertEqual(task["ladder"], "ready")
        self.assertIsNone(task["bot"])
        self.assertFalse(task["qbo_write"])
        queued = self.client.post("/api/monthend/run", json={"key": commissions["key"], "month": "October"})
        self.assertEqual(queued.status_code, 200, queued.get_data(as_text=True))

        manual = self.client.post("/api/monthend/automation", json={"key": payroll["key"], "badge": "Manual"})
        self.assertEqual(manual.status_code, 200, manual.get_data(as_text=True))
        task = next(t for t in manual.get_json()["monthend"]["tasks"] if t["key"] == payroll["key"])
        self.assertEqual(task["automation"], "Manual")
        self.assertEqual(task["ladder"], "manual")
        self.assertIsNone(task["bot"])
        self.assertFalse(task["qbo_write"])
        blocked = self.client.post("/api/monthend/run", json={"key": payroll["key"], "month": "October"})
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("not on Run Now", blocked.get_json()["error"])

        denied = self.client.post("/api/ingest/month-end/automation", json={
            "task": commissions["task"], "due": "1st Week", "automation": "New",
        })
        self.assertEqual(denied.status_code, 401)
        bot = self.client.post(
            "/api/ingest/month-end/automation",
            json={"task": commissions["task"], "due": "1st Week", "automation": "New"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(bot.status_code, 200, bot.get_data(as_text=True))
        self.assertEqual(bot.get_json()["automation"], "New")
        self.assertEqual(bot.get_json()["ladder"], "manual")
        missing = self.client.post(
            "/api/ingest/month-end/automation",
            json={"task": "Not a real line", "due": "1st week", "automation": "Manual"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(missing.status_code, 404)
        bad = self.client.post("/api/monthend/automation", json={"key": commissions["key"], "automation": "Candidate"})
        self.assertEqual(bad.status_code, 400)

        seed = (ROOT / "seed" / "month_end_2026.csv").read_text(encoding="utf-8")
        rows = list(csv.reader(io.StringIO(seed)))
        rows[1][4] = (rows[1][4] or "") + " badge-keep"
        rows.append(["1st week", "", "Test", "Brand New Checklist Line", "from the bot", "Luke", *([""] * 12)])
        buf = io.StringIO()
        csv.writer(buf).writerows(rows)
        synced = self.client.post(
            "/api/ingest/month-end",
            data=buf.getvalue(),
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "text/csv"},
        )
        self.assertEqual(synced.status_code, 200, synced.get_data(as_text=True))
        after = self.client.get("/api/monthend").get_json()
        kept_c = next(t for t in after["tasks"] if t["key"] == commissions["key"])
        kept_p = next(t for t in after["tasks"] if t["key"] == payroll["key"])
        fresh = next(t for t in after["tasks"] if t["task"] == "Brand New Checklist Line")
        self.assertEqual(kept_c["automation"], "New")
        self.assertEqual(kept_p["automation"], "Manual")
        self.assertEqual(fresh["automation"], "New")
        self.assertIsNone(fresh["candidate"])

        back = self.client.post(
            "/api/ingest/month-end/automation",
            json={"task": payroll["task"], "due": "2nd Week", "automation": "ready"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(back.status_code, 200, back.get_data(as_text=True))
        self.assertEqual(back.get_json()["automation"], "Run Now- Ready")
        self.assertEqual(back.get_json()["ladder"], "ready")

        app2 = create_app(config(self.tmp.name))
        client2 = app2.test_client()
        client2.post("/login", data={"password": PASSWORD})
        again = client2.get("/api/monthend").get_json()
        self.assertEqual(next(t for t in again["tasks"] if t["key"] == commissions["key"])["automation"], "New")
        restored = next(t for t in again["tasks"] if t["key"] == payroll["key"])
        self.assertEqual(restored["automation"], "Run Now- Ready")
        self.assertEqual(restored["bot"], "Grok Bot / Month-End")
        self.assertEqual(next(t for t in again["tasks"] if t["task"] == "Brand New Checklist Line")["automation"], "New")

    def test_permanent_ids_survive_sync_and_can_be_linked(self):
        self.authed()
        month = self.client.get("/api/monthend").get_json()
        ids = [t["me_id"] for t in month["tasks"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(re.fullmatch(r"ME-\d{3,}", i) for i in ids))
        first = min(month["tasks"], key=lambda t: t["row"])
        self.assertEqual(first["task"], "Prep COT & Send to Sheldon")
        self.assertEqual(first["me_id"], "ME-001")
        commissions = next(t for t in month["tasks"] if t["task"] == "Run SalesPeople Commissions")
        kept_id = commissions["me_id"]
        self.client.post("/api/monthend/note", json={"key": commissions["key"], "text": "use the latest export"})
        self.client.post("/api/monthend/completion", json={
            "key": commissions["key"], "month": "October", "status": "done",
            "date": "2026-10-11", "note": "office",
        })
        self.client.post("/api/monthend/automation", json={"key": commissions["key"], "automation": "Run Now- Ready"})
        self.client.post("/api/monthend/filereq", json={
            "key": commissions["key"],
            "item": {"name": "Commission workbook", "hint": "from the share", "types": ".xlsx", "required": True},
        })

        seed = (ROOT / "seed" / "month_end_2026.csv").read_text(encoding="utf-8")
        rows = list(csv.reader(io.StringIO(seed)))
        renamed = None
        for row in rows[1:]:
            if row[3].strip() == "Run SalesPeople Commissions":
                row[0] = "2nd Week"
                row[3] = "Sales Commissions Renamed"
                row[4] = (row[4] or "") + " moved"
                renamed = row
        self.assertIsNotNone(renamed)
        buf = io.StringIO()
        csv.writer(buf).writerows(rows)
        synced = self.client.post(
            "/api/ingest/month-end",
            data=buf.getvalue(),
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "text/csv"},
        )
        self.assertEqual(synced.status_code, 200, synced.get_data(as_text=True))
        after = self.client.get("/api/monthend").get_json()
        self.assertEqual(next(t for t in after["tasks"] if t["task"] == "Prep COT & Send to Sheldon")["me_id"], "ME-001")
        fresh = next(t for t in after["tasks"] if t["task"] == "Sales Commissions Renamed")
        temp_id = fresh["me_id"]
        self.assertNotEqual(temp_id, kept_id)
        self.assertTrue(fresh["new"])
        self.assertEqual(fresh["automation"], "New")
        gone = next(t for t in after["removed"] if t["task"] == "Run SalesPeople Commissions")
        self.assertEqual(gone["me_id"], kept_id)

        denied = self.client.post("/api/ingest/month-end/link", json={"id": temp_id, "link_to": kept_id})
        self.assertEqual(denied.status_code, 401)
        linked = self.client.post(
            "/api/ingest/month-end/link",
            json={"task": "Sales Commissions Renamed", "due": "2nd Week", "link_to": kept_id},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(linked.status_code, 200, linked.get_data(as_text=True))
        self.assertEqual(linked.get_json()["id"], kept_id)
        self.assertEqual(linked.get_json()["badge"], "Run Now- Ready")
        month = self.client.get("/api/monthend").get_json()
        moved = next(t for t in month["tasks"] if t["task"] == "Sales Commissions Renamed")
        self.assertEqual(moved["me_id"], kept_id)
        self.assertEqual(moved["note"]["text"], "use the latest export")
        self.assertEqual(moved["completion"]["October"]["note"], "office")
        self.assertEqual(moved["completion"]["October"]["source"], "manual")
        self.assertEqual(moved["automation"], "Run Now- Ready")
        self.assertTrue(any(n["name"] == "Commission workbook" for n in moved["files"]["needs"]))
        self.assertFalse(moved["new"])
        self.assertFalse(any(t["task"] == "Run SalesPeople Commissions" for t in month["removed"]))
        self.assertNotIn(temp_id, [t["me_id"] for t in month["tasks"] + month["removed"]])

        listed = self.client.get("/api/ingest/month-end/tasks", headers={"Authorization": f"Bearer {TOKEN}"})
        self.assertEqual(listed.status_code, 200, listed.get_data(as_text=True))
        body = listed.get_json()
        self.assertEqual(body["month"], "October")
        found = next(t for t in body["tasks"] if t["id"] == kept_id)
        self.assertEqual(set(found), {"id", "task", "due", "badge", "status", "notes"})
        self.assertEqual(found["task"], "Sales Commissions Renamed")
        self.assertEqual(found["due"], "2nd Week")
        self.assertEqual(found["badge"], "Run Now- Ready")
        self.assertEqual(found["notes"], "use the latest export")
        self.assertEqual(found["status"], "done")

        by_id = self.client.post(
            "/api/ingest/month-end/status",
            json={"id": "ME-" + str(int(kept_id.split("-")[1])), "month": "November", "status": "in_progress"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(by_id.status_code, 200, by_id.get_data(as_text=True))
        self.assertEqual(by_id.get_json()["id"], kept_id)
        self.assertEqual(by_id.get_json()["completion"]["status"], "in_progress")
        badged = self.client.post(
            "/api/ingest/month-end/automation",
            json={"id": kept_id, "automation": "Manual"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(badged.status_code, 200, badged.get_data(as_text=True))
        self.assertEqual(badged.get_json()["automation"], "Manual")
        missing = self.client.post(
            "/api/ingest/month-end/automation",
            json={"id": "ME-999", "automation": "Manual"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(missing.status_code, 404)

        rows.append(["3rd Week", "", "Test", "Second Brand New Line", "", "Luke", *([""] * 12)])
        buf = io.StringIO()
        csv.writer(buf).writerows(rows)
        again = self.client.post(
            "/api/ingest/month-end",
            data=buf.getvalue(),
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "text/csv"},
        )
        self.assertEqual(again.status_code, 200, again.get_data(as_text=True))
        latest = self.client.get("/api/monthend").get_json()
        newer = next(t for t in latest["tasks"] if t["task"] == "Second Brand New Line")
        self.assertNotEqual(newer["me_id"], temp_id)
        self.assertNotEqual(newer["me_id"], kept_id)
        self.assertGreater(int(newer["me_id"].split("-")[1]), int(temp_id.split("-")[1]))

        app2 = create_app(config(self.tmp.name))
        client2 = app2.test_client()
        client2.post("/login", data={"password": PASSWORD})
        still = client2.get("/api/monthend").get_json()
        self.assertEqual(next(t for t in still["tasks"] if t["task"] == "Sales Commissions Renamed")["me_id"], kept_id)
        self.assertEqual(next(t for t in still["tasks"] if t["task"] == "Sales Commissions Renamed")["note"]["text"], "use the latest export")

    def test_link_suggestion_dismiss_lasts_until_the_text_changes(self):
        self.authed()
        month = self.client.get("/api/monthend").get_json()
        commissions = next(t for t in month["tasks"] if t["task"] == "Run SalesPeople Commissions")
        kept_id = commissions["me_id"]
        seed = (ROOT / "seed" / "month_end_2026.csv").read_text(encoding="utf-8")
        rows = list(csv.reader(io.StringIO(seed)))
        renamed = None
        for row in rows[1:]:
            if row[3].strip() == "Run SalesPeople Commissions":
                row[0] = "2nd Week"
                row[3] = "Sales Commissions Renamed"
                renamed = row
        buf = io.StringIO()
        csv.writer(buf).writerows(rows)
        synced = self.client.post(
            "/api/ingest/month-end",
            data=buf.getvalue(),
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "text/csv"},
        )
        self.assertEqual(synced.status_code, 200, synced.get_data(as_text=True))
        fresh = next(t for t in self.client.get("/api/monthend").get_json()["tasks"] if t["task"] == "Sales Commissions Renamed")
        self.assertFalse(fresh["link_dismissed"])
        denied = self.client.post("/api/ingest/month-end/link/dismiss", json={"id": fresh["me_id"]})
        self.assertEqual(denied.status_code, 401)
        hidden = self.client.post("/api/monthend/link/dismiss", json={"key": fresh["key"]})
        self.assertEqual(hidden.status_code, 200, hidden.get_data(as_text=True))
        self.assertTrue(hidden.get_json()["dismissed"])
        fresh = next(t for t in hidden.get_json()["monthend"]["tasks"] if t["key"] == fresh["key"])
        self.assertTrue(fresh["link_dismissed"])

        renamed[4] = (renamed[4] or "") + " note only"
        buf = io.StringIO()
        csv.writer(buf).writerows(rows)
        kept = self.client.post(
            "/api/ingest/month-end",
            data=buf.getvalue(),
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "text/csv"},
        )
        self.assertEqual(kept.status_code, 200, kept.get_data(as_text=True))
        still = next(t for t in self.client.get("/api/monthend").get_json()["tasks"] if t["task"] == "Sales Commissions Renamed")
        self.assertTrue(still["link_dismissed"])
        self.assertEqual(still["due"], "2nd Week")
        app2 = create_app(config(self.tmp.name))
        client2 = app2.test_client()
        client2.post("/login", data={"password": PASSWORD})
        again = next(t for t in client2.get("/api/monthend").get_json()["tasks"] if t["key"] == still["key"])
        self.assertTrue(again["link_dismissed"])

        renamed[0] = "2nd week"
        buf = io.StringIO()
        csv.writer(buf).writerows(rows)
        changed = self.client.post(
            "/api/ingest/month-end",
            data=buf.getvalue(),
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "text/csv"},
        )
        self.assertEqual(changed.status_code, 200, changed.get_data(as_text=True))
        revived = next(t for t in self.client.get("/api/monthend").get_json()["tasks"] if t["task"] == "Sales Commissions Renamed")
        self.assertEqual(revived["due"], "2nd week")
        self.assertEqual(revived["key"], still["key"])
        self.assertFalse(revived["link_dismissed"])

        bot = self.client.post(
            "/api/ingest/month-end/link/dismiss",
            json={"id": revived["me_id"]},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(bot.status_code, 200, bot.get_data(as_text=True))
        self.assertTrue(bot.get_json()["dismissed"])
        self.assertEqual(bot.get_json()["id"], revived["me_id"])
        missing = self.client.post(
            "/api/ingest/month-end/link/dismiss",
            json={"id": "ME-999"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(missing.status_code, 404)
        linked = self.client.post(
            "/api/monthend/link",
            json={"id": revived["me_id"], "link_to": kept_id},
        )
        self.assertEqual(linked.status_code, 200, linked.get_data(as_text=True))
        moved = next(t for t in linked.get_json()["monthend"]["tasks"] if t["task"] == "Sales Commissions Renamed")
        self.assertEqual(moved["me_id"], kept_id)
        self.assertFalse(moved["new"])

    def test_month_end_history_images(self):
        self.authed()
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        )
        jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 32
        month = self.client.get("/api/monthend").get_json()
        commissions = next(t for t in month["tasks"] if t["task"] == "Run SalesPeople Commissions")
        kept_id = commissions["me_id"]

        def upload(client, token, image, filename, ctype, caption=None, me_id=kept_id, month_s="2026-10"):
            data = {"id": me_id, "month": month_s, "file": (io.BytesIO(image), filename, ctype)}
            if caption is not None:
                data["caption"] = caption
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            return client.post("/api/ingest/month-end/attachment", data=data, headers=headers)

        first = upload(self.client, TOKEN, png, "close.png", "image/png", "October close")
        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        saved = first.get_json()["attachment"]
        self.assertEqual(first.get_json()["id"], kept_id)
        self.assertEqual(first.get_json()["month"], "2026-10")
        self.assertEqual(saved["caption"], "October close")
        self.assertEqual(saved["content_type"], "image/png")
        self.assertTrue(saved["url"].startswith("/api/monthend/attachments/"))

        second = upload(self.client, TOKEN, jpeg, "note.jpg", "image/jpeg")
        self.assertEqual(second.status_code, 200, second.get_data(as_text=True))
        self.assertEqual(second.get_json()["attachment"]["caption"], "")

        listed = self.client.get(
            f"/api/ingest/month-end/attachments?id={kept_id}&month=2026-10",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(listed.status_code, 200, listed.get_data(as_text=True))
        body = listed.get_json()
        self.assertEqual([item["id"] for item in body["attachments"]], [saved["id"], second.get_json()["attachment"]["id"]])
        self.assertNotIn("url", body["attachments"][0])
        self.assertNotIn("file", body["attachments"][0])

        guest = create_app(config(self.tmp.name)).test_client()
        self.assertEqual(guest.get(saved["url"]).status_code, 401)
        self.assertEqual(
            guest.get(saved["url"], headers={"Authorization": f"Bearer {TOKEN}"}).status_code, 401
        )
        image = self.client.get(saved["url"])
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image.mimetype, "image/png")
        self.assertTrue(image.data.startswith(b"\x89PNG"))
        self.assertEqual(image.headers["X-Content-Type-Options"], "nosniff")

        fresh = self.client.get("/api/monthend").get_json()
        row = next(t for t in fresh["tasks"] if t["me_id"] == kept_id)
        self.assertEqual(len(row["attachments"]["2026-10"]), 2)
        shared = next(t for t in fresh["tasks"] if t["task"] == "Update Perform Shared Resources Spreadsheet")
        october = next(h for h in shared["history"] if h.get("month") == "October")
        self.assertEqual(october["month_iso"], "2026-10")

        seed = (ROOT / "seed" / "month_end_2026.csv").read_text(encoding="utf-8")
        rows = list(csv.reader(io.StringIO(seed)))
        for row in rows[1:]:
            if row[3].strip() == "Run SalesPeople Commissions":
                row[0] = "2nd Week"
                row[3] = "Sales Commissions Renamed"
        buf = io.StringIO()
        csv.writer(buf).writerows(rows)
        synced = self.client.post(
            "/api/ingest/month-end",
            data=buf.getvalue(),
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "text/csv"},
        )
        self.assertEqual(synced.status_code, 200, synced.get_data(as_text=True))
        renamed = next(t for t in self.client.get("/api/monthend").get_json()["tasks"] if t["task"] == "Sales Commissions Renamed")
        linked = self.client.post("/api/monthend/link", json={"id": renamed["me_id"], "link_to": kept_id})
        self.assertEqual(linked.status_code, 200, linked.get_data(as_text=True))
        moved = next(t for t in linked.get_json()["monthend"]["tasks"] if t["me_id"] == kept_id)
        self.assertEqual(len(moved["attachments"]["2026-10"]), 2)
        still = self.client.get(
            f"/api/ingest/month-end/attachments?id={kept_id}&month=2026-10",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(len(still.get_json()["attachments"]), 2)

        removed = self.client.delete("/api/monthend/attachments/" + saved["id"])
        self.assertEqual(removed.status_code, 200, removed.get_data(as_text=True))
        self.assertEqual(self.client.get(saved["url"]).status_code, 404)
        left = self.client.get(
            f"/api/ingest/month-end/attachments?id={kept_id}&month=2026-10",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual([item["id"] for item in left.get_json()["attachments"]], [second.get_json()["attachment"]["id"]])

        app2 = create_app(config(self.tmp.name))
        client2 = app2.test_client()
        client2.post("/login", data={"password": PASSWORD})
        again = client2.get(
            f"/api/ingest/month-end/attachments?id={kept_id}&month=2026-10",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        self.assertEqual(again.status_code, 200)
        self.assertEqual(len(again.get_json()["attachments"]), 1)
        kept_image = "/api/monthend/attachments/" + left.get_json()["attachments"][0]["id"]
        self.assertEqual(client2.get(kept_image).status_code, 200)

        bad_type = upload(self.client, TOKEN, b"GIF89a", "anim.gif", "image/gif")
        self.assertEqual(bad_type.status_code, 400)
        mismatch = upload(self.client, TOKEN, jpeg, "close.png", "image/png")
        self.assertEqual(mismatch.status_code, 400)
        empty = upload(self.client, TOKEN, b"", "close.png", "image/png")
        self.assertEqual(empty.status_code, 400)
        huge = upload(self.client, TOKEN, b"\x89PNG\r\n\x1a\n" + b"\x00" * (10 * 1024 * 1024), "big.png", "image/png")
        self.assertEqual(huge.status_code, 400)
        self.assertIn("10 MB", huge.get_json()["error"])
        unknown = upload(self.client, TOKEN, png, "close.png", "image/png", me_id="ME-999")
        self.assertEqual(unknown.status_code, 404)
        bad_month = upload(self.client, TOKEN, png, "close.png", "image/png", month_s="October")
        self.assertEqual(bad_month.status_code, 400)

        pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
        posted = upload(self.client, TOKEN, pdf, "close.pdf", "application/pdf", "September packet")
        self.assertEqual(posted.status_code, 200, posted.get_data(as_text=True))
        saved_pdf = posted.get_json()["attachment"]
        self.assertEqual(saved_pdf["content_type"], "application/pdf")
        self.assertEqual(saved_pdf["caption"], "September packet")
        self.assertEqual(saved_pdf["name"], "close.pdf")
        page = self.client.get("/").get_data(as_text=True)
        self.assertIn("a.pdflink", page)
        self.assertIn('target="_blank"', page)
        self.assertEqual(guest.get(saved_pdf["url"]).status_code, 401)
        opened = self.client.get(saved_pdf["url"])
        self.assertEqual(opened.status_code, 200)
        self.assertEqual(opened.mimetype, "application/pdf")
        self.assertTrue(opened.data.startswith(b"%PDF-"))
        self.assertEqual(opened.headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("inline", opened.headers.get("Content-Disposition", ""))
        fresh = self.client.get("/api/monthend").get_json()
        row = next(t for t in fresh["tasks"] if t["me_id"] == kept_id)
        stored = row["attachments"]["2026-10"]
        self.assertTrue(any(item["content_type"] == "application/pdf" and item["name"] == "close.pdf" for item in stored))
        declared = upload(self.client, TOKEN, pdf, "close.png", "image/png")
        self.assertEqual(declared.status_code, 400)

    def test_month_end_writebacks(self):
        httpd = self._webhook_server()
        secret = "sheet-writer"
        url = f"http://127.0.0.1:{httpd.server_address[1]}/hook"
        self.authed()
        saved = self.client.post("/api/settings", json={"sync_webhook_url": url, "sync_webhook_key": secret})
        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        month = self.client.get("/api/monthend").get_json()
        bonuses = next(t for t in month["tasks"] if t["task"].startswith("Review Tech Bonuses"))
        payroll = next(t for t in month["tasks"] if t["task"] == "Payroll Report")
        headers = {"Authorization": f"Bearer {TOKEN}"}

        bot = self.client.post("/api/ingest/month-end/status", json={
            "id": payroll["me_id"], "month": "October", "status": "done", "date": "2026-10-10",
        }, headers=headers)
        self.assertEqual(bot.status_code, 200, bot.get_data(as_text=True))
        quiet = self.client.get("/api/ingest/month-end/writebacks?status=pending", headers=headers)
        self.assertEqual(quiet.status_code, 200, quiet.get_data(as_text=True))
        self.assertEqual(quiet.get_json()["writebacks"], [])
        self.assertEqual(httpd.got_body, b"")

        marked = self.client.post("/api/monthend/completion", json={
            "key": bonuses["key"], "month": "October", "status": "done", "date": "2026-10-11", "note": "office",
        })
        self.assertEqual(marked.status_code, 200, marked.get_data(as_text=True))
        self.assertEqual(marked.get_json()["writeback"], "queued")
        self.assertTrue(marked.get_json()["webhook"]["ok"])
        posted = json.loads(httpd.got_body)
        self.assertEqual(posted["source"], "automation-dashboard")
        self.assertEqual(posted["action"], "month-end-sync")
        self.assertEqual(httpd.got_headers.get("authorization"), f"Bearer {secret}")
        self.assertEqual(httpd.got_headers.get("x-webhook-key"), secret)
        self.assertEqual(httpd.got_headers.get("x-api-key"), secret)

        listed = self.client.get("/api/ingest/month-end/writebacks?status=pending", headers=headers)
        items = listed.get_json()["writebacks"]
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item["id"], bonuses["me_id"])
        self.assertEqual(item["task"], bonuses["task"])
        self.assertEqual(item["due"], bonuses["due"])
        self.assertEqual(item["month"], "2026-10")
        self.assertEqual(item["done_date"], "10/11")
        self.assertEqual(item["status"], "pending")
        self.assertEqual(item["row"], bonuses["row"])
        self.assertTrue(item["writeback_id"])
        self.assertTrue(item["created_at"])
        same = self.client.get("/api/ingest/month-end/writebacks", headers=headers)
        self.assertEqual(same.get_json()["writebacks"], items)

        again = self.client.post("/api/monthend/completion", json={
            "key": bonuses["key"], "month": "October", "status": "done", "date": "2026-10-12",
        })
        self.assertEqual(again.status_code, 200)
        updated = self.client.get("/api/ingest/month-end/writebacks?status=pending", headers=headers).get_json()["writebacks"]
        self.assertEqual(len(updated), 1)
        self.assertEqual(updated[0]["writeback_id"], item["writeback_id"])
        self.assertEqual(updated[0]["done_date"], "10/12")
        self.assertEqual(updated[0]["created_at"], item["created_at"])

        undone = self.client.post("/api/monthend/completion", json={
            "key": bonuses["key"], "month": "October", "status": "not_started",
        })
        self.assertEqual(undone.get_json()["writeback"], "cancelled")
        self.assertNotIn("webhook", undone.get_json())
        empty = self.client.get("/api/ingest/month-end/writebacks?status=pending", headers=headers)
        self.assertEqual(empty.get_json()["writebacks"], [])
        cancelled = self.client.post(
            f"/api/ingest/month-end/writebacks/{item['writeback_id']}/result",
            json={"status": "written"},
            headers=headers,
        )
        self.assertEqual(cancelled.status_code, 400)

        remarked = self.client.post("/api/monthend/completion", json={
            "key": bonuses["key"], "month": "October", "status": "done", "date": "2026-10-11",
        })
        self.assertEqual(remarked.status_code, 200)
        fresh = self.client.get("/api/ingest/month-end/writebacks?status=pending", headers=headers).get_json()["writebacks"]
        self.assertEqual(len(fresh), 1)
        self.assertNotEqual(fresh[0]["writeback_id"], item["writeback_id"])
        flagged = self.client.post(
            f"/api/ingest/month-end/writebacks/{fresh[0]['writeback_id']}/result",
            json={"status": "flagged", "note": "row was empty"},
            headers=headers,
        )
        self.assertEqual(flagged.status_code, 200, flagged.get_data(as_text=True))
        self.assertEqual(flagged.get_json()["writeback"]["status"], "flagged")
        self.assertEqual(flagged.get_json()["writeback"]["row"], bonuses["row"])
        shown = self.client.get("/api/monthend").get_json()
        row = next(t for t in shown["tasks"] if t["key"] == bonuses["key"])
        self.assertEqual(row["writebacks"]["October"]["note"], "row was empty")
        self.assertEqual(row["writebacks"]["October"]["status"], "flagged")
        self.assertEqual(self.client.get("/api/ingest/month-end/writebacks?status=pending", headers=headers).get_json()["writebacks"], [])

        skipped = self.client.post("/api/monthend/completion", json={
            "key": bonuses["key"], "month": "November", "status": "done", "date": "2026-11-02",
        })
        self.assertEqual(skipped.status_code, 200)
        nov = self.client.get("/api/ingest/month-end/writebacks?status=pending", headers=headers).get_json()["writebacks"]
        self.assertEqual(len(nov), 1)
        self.assertEqual(nov[0]["month"], "2026-11")
        self.assertEqual(nov[0]["done_date"], "11/2")
        result = self.client.post(
            f"/api/ingest/month-end/writebacks/{nov[0]['writeback_id']}/result",
            json={"status": "skipped", "note": "cell is locked"},
            headers=headers,
        )
        self.assertEqual(result.status_code, 200)
        both = self.client.get("/api/monthend").get_json()
        row = next(t for t in both["tasks"] if t["key"] == bonuses["key"])
        self.assertEqual(row["writebacks"]["November"]["status"], "skipped")
        self.assertEqual(row["writebacks"]["October"]["note"], "row was empty")

        written = self.client.post("/api/monthend/completion", json={
            "key": payroll["key"], "month": "November", "status": "done",
        })
        self.assertEqual(written.status_code, 200)
        waiting = self.client.get("/api/ingest/month-end/writebacks?status=pending", headers=headers).get_json()["writebacks"]
        self.assertEqual(len(waiting), 1)
        self.assertEqual(waiting[0]["id"], payroll["me_id"])
        self.assertEqual(waiting[0]["done_date"], "10/10")
        done = self.client.post(
            f"/api/ingest/month-end/writebacks/{waiting[0]['writeback_id']}/result",
            json={"status": "written", "note": "P column"},
            headers=headers,
        )
        self.assertEqual(done.status_code, 200)
        clear = self.client.get("/api/monthend").get_json()
        pay = next(t for t in clear["tasks"] if t["key"] == payroll["key"])
        self.assertEqual(pay["writebacks"], {})

        missing = self.client.post(
            "/api/ingest/month-end/writebacks/does-not-exist/result",
            json={"status": "written"},
            headers=headers,
        )
        self.assertEqual(missing.status_code, 404)
        bad = self.client.post(
            f"/api/ingest/month-end/writebacks/{fresh[0]['writeback_id']}/result",
            json={"status": "pending"},
            headers=headers,
        )
        self.assertEqual(bad.status_code, 400)
        weird = self.client.get("/api/ingest/month-end/writebacks?status=nope", headers=headers)
        self.assertEqual(weird.status_code, 400)

        failed = self._webhook_server(status=503)
        self.client.post("/api/settings", json={
            "sync_webhook_url": f"http://127.0.0.1:{failed.server_address[1]}/hook",
            "sync_webhook_key": "k",
        })
        still = self.client.post("/api/monthend/completion", json={
            "key": payroll["key"], "month": "December", "status": "done", "date": "2026-12-01",
        })
        self.assertEqual(still.status_code, 200, still.get_data(as_text=True))
        self.assertFalse(still.get_json()["webhook"]["ok"])
        self.assertEqual(still.get_json()["webhook"]["status"], 503)
        held = self.client.get("/api/ingest/month-end/writebacks?status=pending", headers=headers).get_json()["writebacks"]
        self.assertEqual(len(held), 1)
        self.assertEqual(held[0]["month"], "2026-12")
        self.assertEqual(held[0]["done_date"], "12/1")

        app2 = create_app(config(self.tmp.name))
        client2 = app2.test_client()
        kept = client2.get("/api/ingest/month-end/writebacks?status=pending", headers=headers)
        self.assertEqual(kept.status_code, 200)
        self.assertEqual(kept.get_json()["writebacks"][0]["writeback_id"], held[0]["writeback_id"])

    def test_vehicle_lease_september_total_and_files(self):
        self.authed()
        page = self.client.get("/vehicle-lease")
        self.assertEqual(page.status_code, 200)
        html = page.get_data(as_text=True)
        self.assertIn("Fleet registry", html)
        self.assertIn("Ignored units", html)
        self.assertIn("Generate", html)
        self.assertIn('id="v-note"', html)
        state = self.client.get("/api/vehicle-lease").get_json()
        self.assertEqual(len(state["vehicles"]), 13)
        self.assertTrue(all("note" in vehicle for vehicle in state["vehicles"]))
        self.assertEqual(len(state["ignored"]), 71)
        self.assertEqual(state["settings"]["gl_account"], "611-3 Vehicle Lease Expense (Internal)")
        self.assertEqual(state["settings"]["credit_location"], "Truck Sales")
        self.assertEqual(state["settings"]["default_rate"], 7.0)
        self.assertEqual(state["settings"]["default_term"], 60)
        self.assertEqual(
            state["settings"]["alloc"],
            {"Covington": 22, "Greenville": 18, "Dayton": 16, "Springfield": 15, "Columbus": 17, "Mobile": 12},
        )
        bad = self.client.put("/api/vehicle-lease/settings", json={
            "gl_account": state["settings"]["gl_account"],
            "credit_location": "Truck Sales",
            "default_rate": 7,
            "default_term": 60,
            "alloc": {"Covington": 40, "Greenville": 10, "Dayton": 10, "Springfield": 10, "Columbus": 10, "Mobile": 10},
        })
        self.assertEqual(bad.status_code, 400)
        self.assertIn("100", bad.get_json()["error"])

        headers = {"Authorization": f"Bearer {TOKEN}"}
        registry = self.client.get("/api/ingest/vehicle-lease/registry", headers=headers)
        self.assertEqual(registry.status_code, 200)
        self.assertEqual(len(registry.get_json()["vehicles"]), 13)
        ignored = self.client.get("/api/ingest/vehicle-lease/ignored", headers=headers)
        self.assertEqual(len(ignored.get_json()["ignored"]), 71)

        run = self.client.post("/api/vehicle-lease/runs", json={"month": "2026-09"})
        self.assertEqual(run.status_code, 200, run.get_data(as_text=True))
        saved = run.get_json()["run"]
        self.assertEqual(saved["active_units"], 13)
        self.assertEqual(saved["total"], 6910.61)
        self.assertEqual(saved["branches"], {
            "Covington": 196.03,
            "Greenville": 734.62,
            "Dayton": 2221.69,
            "Springfield": 529.68,
            "Columbus": 1735.58,
            "Mobile": 1493.01,
        })
        self.assertEqual(saved["fleet_check"]["status"], "ok")
        self.assertIn("13 active units", saved["fleet_check"]["text"])
        je = self.client.get("/api/vehicle-lease/runs/2026-09/je.csv")
        self.assertEqual(je.status_code, 200)
        rows = list(csv.reader(io.StringIO(je.get_data(as_text=True))))
        self.assertEqual(rows[0], ["JournalNo", "JournalDate", "Account", "Debits", "Credits", "Description", "Name", "Location"])
        self.assertEqual(rows[1][0], "VEH-LEASE-SEP2026")
        self.assertEqual(rows[1][1], "09/30/2026")
        self.assertEqual(rows[1][2], "611-3 Vehicle Lease Expense (Internal)")
        self.assertEqual(rows[1][5], "Internal Vehicle Lease - Sep 2026")
        self.assertEqual([row[7] for row in rows[1:]], ["Covington", "Greenville", "Dayton", "Springfield", "Columbus", "Mobile", "Truck Sales"])
        self.assertEqual(rows[-1][3], "")
        self.assertEqual(rows[-1][4], "6,910.61")
        self.assertEqual(rows[-1][2], rows[1][2])
        debits = 0
        for row in rows[1:-1]:
            debits += float(row[3].replace(",", ""))
        self.assertEqual(round(debits, 2), 6910.61)
        detail = self.client.get("/api/vehicle-lease/runs/2026-09/detail.csv")
        detail_rows = list(csv.reader(io.StringIO(detail.get_data(as_text=True))))
        self.assertEqual(detail_rows[0][0], "Branch")
        self.assertIn("All Locations?", detail_rows[0])
        self.assertTrue(any(row[1] == "50" and row[0] == "Greenville" for row in detail_rows[1:]))
        self.assertTrue(any(row[-1] == "Yes" for row in detail_rows[1:]))
        pdf = self.client.get("/api/vehicle-lease/runs/2026-09/report.pdf")
        self.assertEqual(pdf.status_code, 200)
        self.assertTrue(pdf.data.startswith(b"%PDF"))
        self.assertGreater(len(pdf.data), 2000)
        self.assertEqual(pdf.mimetype, "application/pdf")
        self.assertEqual(self.client.get("/api/vehicle-lease/runs/2026-09/je.csv").status_code, 200)

        qbo = self.client.patch("/api/vehicle-lease/runs/2026-09", json={"qbo_je": "1577201"})
        self.assertEqual(qbo.status_code, 200)
        self.assertEqual(qbo.get_json()["run"]["qbo_je"], "1577201")

        je_bytes = je.data
        pdf_bytes = pdf.data
        detail_bytes = detail.data
        uploaded = self.client.post(
            "/api/ingest/vehicle-lease/runs",
            data={
                "month": "2026-08",
                "payload": json.dumps({
                    "total": 6217.57,
                    "active_units": 12,
                    "branches": {"Covington": 196.03, "Dayton": 1528.65},
                    "fleet_check": "All 80 active vehicles accounted for.",
                    "fleet_status": "ok",
                    "qbo_je": "",
                }),
                "je": (io.BytesIO(je_bytes), "veh_lease_JE_AUG2026.csv"),
                "pdf": (io.BytesIO(pdf_bytes), "report.pdf"),
                "detail": (io.BytesIO(detail_bytes), "detail.csv"),
            },
            headers=headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.get_data(as_text=True))
        self.assertEqual(uploaded.get_json()["run"]["total"], 6217.57)
        self.assertEqual(uploaded.get_json()["run"]["fleet_check"]["text"], "All 80 active vehicles accounted for.")
        patched = self.client.patch(
            "/api/ingest/vehicle-lease/runs/2026-08",
            json={"qbo_je": "1577158"},
            headers=headers,
        )
        self.assertEqual(patched.status_code, 200, patched.get_data(as_text=True))
        self.assertEqual(patched.get_json()["run"]["qbo_je"], "1577158")
        missing = self.client.patch("/api/ingest/vehicle-lease/runs/2026-01", json={"qbo_je": "1"}, headers=headers)
        self.assertEqual(missing.status_code, 404)

        added = self.client.post("/api/vehicle-lease/vehicles", json={
            "unit": "99", "nickname": "Test runner", "branch": "Mobile",
            "value": 10000, "start_date": "2026-09-01", "term": 60, "rate": 7, "service_pct": 100,
        })
        self.assertEqual(added.status_code, 200, added.get_data(as_text=True))
        self.assertEqual(len(added.get_json()["vehicle_lease"]["vehicles"]), 14)
        vid = added.get_json()["vehicle"]["id"]
        removed = self.client.delete(f"/api/vehicle-lease/vehicles/{vid}")
        self.assertEqual(len(removed.get_json()["vehicle_lease"]["vehicles"]), 13)

        app2 = create_app(config(self.tmp.name))
        client2 = app2.test_client()
        client2.post("/login", data={"password": PASSWORD})
        again = client2.get("/api/vehicle-lease").get_json()
        self.assertEqual(len(again["vehicles"]), 13)
        self.assertEqual(len(again["ignored"]), 71)
        august = next(item for item in again["runs"] if item["month"] == "2026-08")
        september = next(item for item in again["runs"] if item["month"] == "2026-09")
        self.assertEqual(august["qbo_je"], "1577158")
        self.assertEqual(september["total"], 6910.61)
        self.assertEqual(september["qbo_je"], "1577201")
        self.assertTrue(client2.get("/api/vehicle-lease/runs/2026-09/report.pdf").data.startswith(b"%PDF"))

    def test_vehicle_lease_ingest_writes_and_september_change(self):
        self.authed()
        headers = {"Authorization": f"Bearer {TOKEN}"}
        before = self.client.post("/api/vehicle-lease/runs", json={"month": "2026-09"})
        self.assertEqual(before.status_code, 200, before.get_data(as_text=True))
        self.assertEqual(before.get_json()["run"]["total"], 6910.61)
        self.assertEqual(before.get_json()["run"]["active_units"], 13)

        payload = {
            "unit": "55",
            "nickname": "All locations runner",
            "branch": "All Locations",
            "value": 35000,
            "start_date": "2026-09-01",
            "term": 60,
            "rate": 7,
            "service_pct": 50,
            "note": "shop spare",
        }
        added = self.client.post("/api/ingest/vehicle-lease/registry", json=payload, headers=headers)
        self.assertEqual(added.status_code, 200, added.get_data(as_text=True))
        vehicle = added.get_json()["vehicle"]
        self.assertEqual(vehicle["unit"], "55")
        self.assertEqual(vehicle["note"], "shop spare")
        self.assertEqual(vehicle["value"], 35000)
        self.assertEqual(vehicle["service_pct"], 50)
        duplicate = self.client.post("/api/ingest/vehicle-lease/registry", json=payload, headers=headers)
        self.assertEqual(duplicate.status_code, 409)
        incomplete = self.client.post("/api/ingest/vehicle-lease/registry", json={"unit": "56", "value": 35000}, headers=headers)
        self.assertEqual(incomplete.status_code, 400)

        patched = self.client.patch(
            "/api/ingest/vehicle-lease/registry/55",
            json={"note": "posted by Don"},
            headers=headers,
        )
        self.assertEqual(patched.status_code, 200, patched.get_data(as_text=True))
        self.assertEqual(patched.get_json()["vehicle"]["note"], "posted by Don")
        self.assertEqual(patched.get_json()["vehicle"]["nickname"], "All locations runner")
        self.assertEqual(patched.get_json()["vehicle"]["value"], 35000)
        bad_value = self.client.patch("/api/ingest/vehicle-lease/registry/55", json={"value": 0}, headers=headers)
        self.assertEqual(bad_value.status_code, 400)
        clash = self.client.patch("/api/ingest/vehicle-lease/registry/55", json={"unit": "39"}, headers=headers)
        self.assertEqual(clash.status_code, 409)
        unknown = self.client.patch("/api/ingest/vehicle-lease/registry/nope", json={"note": "x"}, headers=headers)
        self.assertEqual(unknown.status_code, 404)

        run = self.client.post("/api/vehicle-lease/runs", json={"month": "2026-09"})
        self.assertEqual(run.status_code, 200, run.get_data(as_text=True))
        saved = run.get_json()["run"]
        self.assertEqual(saved["active_units"], 14)
        self.assertEqual(saved["total"], 7603.66)
        self.assertEqual(saved["branches"], {
            "Covington": 348.5,
            "Greenville": 859.37,
            "Dayton": 2332.58,
            "Springfield": 633.64,
            "Columbus": 1853.39,
            "Mobile": 1576.18,
        })
        je = self.client.get("/api/vehicle-lease/runs/2026-09/je.csv").get_data(as_text=True)
        self.assertIn("7,603.66", je)
        detail = self.client.get("/api/vehicle-lease/runs/2026-09/detail.csv").get_data(as_text=True)
        self.assertIn("55", detail)

        listed = self.client.get("/api/ingest/vehicle-lease/registry", headers=headers).get_json()
        unit = next(item for item in listed["vehicles"] if item["unit"] == "55")
        self.assertEqual(unit["note"], "posted by Don")
        self.assertEqual(len(listed["vehicles"]), 14)
        page = self.client.get("/api/vehicle-lease").get_json()
        shown = next(item for item in page["vehicles"] if item["unit"] == "55")
        self.assertEqual(shown["note"], "posted by Don")

        removed = self.client.delete("/api/ingest/vehicle-lease/registry/55", headers=headers)
        self.assertEqual(removed.status_code, 200, removed.get_data(as_text=True))
        self.assertEqual(removed.get_json()["unit"], "55")
        self.assertEqual(self.client.delete("/api/ingest/vehicle-lease/registry/55", headers=headers).status_code, 404)
        self.assertEqual(len(self.client.get("/api/vehicle-lease").get_json()["vehicles"]), 13)
        restored = self.client.post("/api/vehicle-lease/runs", json={"month": "2026-09"})
        self.assertEqual(restored.get_json()["run"]["total"], 6910.61)
        self.assertEqual(restored.get_json()["run"]["active_units"], 13)

        one = self.client.post("/api/ingest/vehicle-lease/ignored", json={"unit": "ZZ9"}, headers=headers)
        self.assertEqual(one.status_code, 200, one.get_data(as_text=True))
        self.assertEqual(one.get_json()["added"], ["ZZ9"])
        self.assertEqual(len(one.get_json()["ignored"]), 72)
        many = self.client.post("/api/ingest/vehicle-lease/ignored", json=["ZZ9", "ZZ8"], headers=headers)
        self.assertEqual(many.status_code, 200, many.get_data(as_text=True))
        self.assertEqual(many.get_json()["added"], ["ZZ8"])
        self.assertEqual(len(many.get_json()["ignored"]), 73)
        blank = self.client.post("/api/ingest/vehicle-lease/ignored", json={"unit": " "}, headers=headers)
        self.assertEqual(blank.status_code, 400)
        dropped = self.client.delete("/api/ingest/vehicle-lease/ignored/zz9", headers=headers)
        self.assertEqual(dropped.status_code, 200, dropped.get_data(as_text=True))
        self.assertEqual(dropped.get_json()["unit"], "ZZ9")
        self.assertNotIn("ZZ9", dropped.get_json()["ignored"])
        self.assertEqual(self.client.delete("/api/ingest/vehicle-lease/ignored/ZZ9", headers=headers).status_code, 404)

    def test_demo_seed_is_opt_in(self):
        app = create_app(config(self.tmp.name + "-demo", demo=True))
        client = app.test_client()
        client.post("/login", data={"password": PASSWORD})
        board = client.get("/api/runs?date=2026-10-09").get_json()
        row = next(r for r in board["rows"] if r["id"] == "daily-fullbay-inventory-po-dashboard")
        self.assertEqual(row["ran"], "yes")
        self.assertIn("71 vendors", row["result"])


def live():
    """Boot gunicorn the way Render will and walk the same paths over HTTP."""
    tmp = tempfile.mkdtemp(prefix="dash-live-")
    env = os.environ.copy()
    env.update({
        "DASHBOARD_PASSWORD": "x",
        "SESSION_SECRET": "y",
        "INGEST_TOKEN": "z",
        "DATA_DIR": tmp,
        "PORT": "8765",
        "DEMO_SEED": "",
    })
    cmd = "gunicorn --bind 0.0.0.0:$PORT --workers 2 --timeout 120 --access-logfile - wsgi:app"
    proc = None

    def start():
        nonlocal proc
        proc = subprocess.Popen(["bash", "-lc", cmd], cwd=ROOT, env=env)

    def wait_health():
        deadline = time.time() + 25
        last = ""
        while time.time() < deadline:
            try:
                with urllib.request.urlopen("http://127.0.0.1:8765/healthz", timeout=2) as res:
                    if res.status == 200 and json.loads(res.read())["ok"]:
                        return
            except Exception as exc:  # noqa: BLE001 — server may still be booting
                last = str(exc)
                time.sleep(0.3)
        raise SystemExit(f"healthz did not come up: {last}")

    def stop():
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()

    start()
    try:
        wait_health()
        jar = urllib.request.HTTPCookieProcessor()
        opener = urllib.request.build_opener(jar)

        def call(method, path, data=None, headers=None, token=None):
            req = urllib.request.Request("http://127.0.0.1:8765" + path, data=data, method=method)
            for k, v in (headers or {}).items():
                req.add_header(k, v)
            if token:
                req.add_header("Authorization", "Bearer " + token)
            try:
                with opener.open(req, timeout=20) as res:
                    raw = res.read()
                    return res.status, raw
            except urllib.error.HTTPError as exc:
                return exc.code, exc.read()

        status, _ = call("GET", "/api/runs?date=2026-10-10")
        assert status == 401, status
        status, page = call("POST", "/login", urllib.parse.urlencode({"password": "x", "next": "/"}).encode(), {"Content-Type": "application/x-www-form-urlencoded"})
        assert status in (200, 302), status
        status, page = call("GET", "/")
        assert status == 200, status
        text = page.decode()
        assert "Today / Daily runs" in text and "All automations" in text and "On demand" in text
        status, raw = call("GET", "/api/automations")
        assert status == 200 and len(json.loads(raw)["automations"]) == 30
        status, raw = call("GET", "/api/monthend")
        assert status == 200 and json.loads(raw)["luke_count"] > 0
        status, raw = call("POST", "/api/ingest/runs", json.dumps({
            "bot": "Time Edit Project",
            "automation_id": "time-edit-state-backup-before-nightly-deploy",
            "timestamp": "2026-10-10T02:50:00-04:00",
            "status": "ok",
            "summary": "Live smoke snapshot",
        }).encode(), {"Content-Type": "application/json"}, token="z")
        assert status == 200, raw
        status, raw = call("GET", "/api/runs?date=2026-10-10")
        board = json.loads(raw)
        row = next(r for r in board["rows"] if r["id"] == "time-edit-state-backup-before-nightly-deploy")
        assert row["result"] == "Live smoke snapshot", row
        month = json.loads(call("GET", "/api/monthend")[1])
        task = next(t for t in month["tasks"] if t["key"] == K13)
        status, raw = call("POST", "/api/monthend/note", json.dumps({"key": task["key"], "text": "persists across restart"}).encode(), {"Content-Type": "application/json"})
        assert status == 200, raw
        status, raw = call("POST", "/api/monthend/run", json.dumps({"key": K13, "month": "November", "run_note": "live"}).encode(), {"Content-Type": "application/json"})
        assert status == 200, raw
        rid = json.loads(raw)["id"]
        status, raw = call("GET", "/api/ingest/run-requests", token="z")
        assert status == 200 and json.loads(raw)["requests"][0]["id"] == rid
        status, raw = call("POST", f"/api/ingest/run-requests/{rid}/complete", json.dumps({
            "status": "succeeded", "notes": "live complete", "done_date": "2026-10-10",
        }).encode(), {"Content-Type": "application/json"}, token="z")
        assert status == 200, raw
        stop()
        start()
        wait_health()
        jar.cookiejar.clear()
        call("POST", "/login", urllib.parse.urlencode({"password": "x", "next": "/"}).encode(), {"Content-Type": "application/x-www-form-urlencoded"})
        month = json.loads(call("GET", "/api/monthend")[1])
        task = next(t for t in month["tasks"] if t["key"] == K13)
        assert task["note"]["text"] == "persists across restart", task.get("note")
        assert task["months"]["November"]["text"] == "10/10"
        print("live smoke ok", tmp)
    finally:
        stop()


if __name__ == "__main__":
    import urllib.parse
    if "--live" in sys.argv:
        live()
    else:
        unittest.main()
