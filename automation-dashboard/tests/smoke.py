"""Smoke tests for the automation dashboard.

    python tests/smoke.py
    python tests/smoke.py --live
"""
import base64
import csv
import io
import json
import os
import subprocess
import sys
import tempfile
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
        self.assertNotIn("localStorage", body)
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
        self.assertEqual(new["assigned"], "Luke")
        self.assertTrue(any(t["task"] == removed_name for t in month["removed"]))

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
