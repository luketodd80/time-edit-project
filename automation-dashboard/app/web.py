"""Pages and session-authenticated JSON for the dashboard."""
import base64
import binascii
import datetime
import json
import os
import re
import uuid
from pathlib import Path

import html

from flask import Response, current_app, jsonify, redirect, request

from app import clock
from app.attachments import delete_attachment, open_attachment
from app.auth import clear_session, logged_in, password_ok, safe_next, set_session
from app.catalog import annotated, apply_override, public_view
from app.modules import MODULES
from app.month_end import MONTHS, decorate, parse_automation_badge, parse_completion_request, task_key_from
from app.schedule import build_day, fmt_last_run
from app.settings_store import public_settings, save_settings
from app.sync_hook import request_month_end_sync

ROOT = Path(__file__).resolve().parent.parent


def _page(name):
    return (ROOT / "templates" / name).read_text(encoding="utf-8")


def _login_page(error, nxt):
    return (
        _page("login.html")
        .replace("__ERROR__", html.escape(error or ""))
        .replace("__NEXT__", html.escape(nxt or "/", quote=True))
    )


def _db():
    return current_app.extensions["db"]


def _me():
    return current_app.extensions["month_end"]


def _body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _month_payload():
    data = _me().load_and_sync()
    data["log"] = _db().run_log()
    return decorate(data, _db().all_requests())


def _autos():
    overrides = _db().overrides()
    out = []
    for item in annotated():
        merged = apply_override(item, overrides.get(item["id"]))
        latest = _db().latest_run(item["id"])
        if latest:
            merged = dict(merged)
            merged["last_run"] = fmt_last_run(latest["ts"])
        out.append(public_view(merged))
    return out


def _save_files(task_key, day, files):
    saved = []
    slug = re.sub(r"[^a-z0-9]+", "-", task_key.lower()).strip("-")[:80] or "task"
    dest = current_app.config["DATA_DIR_PATH"] / "uploads" / slug / day
    dest.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(files or []):
        name = os.path.basename(str(f.get("name") or "file")).replace("..", "_") or "file"
        try:
            raw = base64.b64decode(f.get("data_b64") or "", validate=False)
        except binascii.Error as exc:
            raise ValueError(f"could not read {name}") from exc
        if len(raw) > 20 * 1024 * 1024:
            raise ValueError(f"{name} is over 20 MB")
        path = dest / name
        if path.exists():
            path = dest / f"{i}-{name}"
        path.write_bytes(raw)
        saved.append({
            "name": name,
            "size": int(f.get("size") or len(raw)),
            "type": str(f.get("type") or ""),
            "need": str(f.get("need") or ""),
            "file_note": str(f.get("file_note") or ""),
            "path": str(path.relative_to(current_app.config["DATA_DIR_PATH"])),
        })
    return saved


def register(app):
    @app.get("/healthz")
    def healthz():
        return jsonify(ok=True)

    @app.get("/login")
    def login_form():
        if logged_in():
            return redirect(safe_next(request.args.get("next")))
        return _login_page("", safe_next(request.args.get("next")))

    @app.post("/login")
    def login_post():
        got = request.form.get("password") or (_body().get("password") if request.is_json else "")
        nxt = safe_next(request.form.get("next") or request.args.get("next"))
        if not password_ok(got):
            return _login_page("Wrong password.", nxt), 401
        return set_session(redirect(nxt))

    @app.post("/logout")
    def logout():
        return clear_session(redirect("/login"))

    @app.get("/")
    def index():
        moment = clock.now()
        dash = {
            "today": moment.date().isoformat(),
            "month": MONTHS[moment.month - 1],
            "tabs": MODULES,
        }
        return _page("index.html").replace("__DASH_JSON__", json.dumps(dash))

    @app.get("/api/automations")
    def automations():
        return jsonify(automations=_autos(), log=_db().command_log())

    @app.post("/api/command")
    def command():
        body = _body()
        autos = {a["id"]: apply_override(a, _db().overrides().get(a["id"])) for a in annotated()}
        auto = autos.get(body.get("id"))
        action = body.get("action")
        new = {"pause": "paused", "resume": "active", "retire": "retired"}.get(action)
        if not auto or not new:
            return jsonify(error="bad command"), 400
        if auto["status"] == "retired":
            return jsonify(error="already retired"), 409
        nxt = auto.get("_catalog_next") if new == "active" else None
        _db().set_status(auto["id"], new, nxt)
        entry = _db().add_command(auto["id"], auto["name"], action, "Saved here. Not sent to the bot.")
        updated = dict(auto)
        updated["status"] = new
        updated["next_run"] = nxt
        return jsonify(ok=True, automation=public_view(updated), log=entry)

    @app.get("/api/runs")
    def runs():
        raw = request.args.get("date") or clock.now().date().isoformat()
        try:
            day = datetime.date.fromisoformat(raw)
        except ValueError:
            return jsonify(error="bad date, use YYYY-MM-DD"), 400
        moment = clock.now()
        payload = build_day(
            day, moment.date(), moment,
            _db().runs_on(day.isoformat()),
            _db().all_requests(),
            _db().overrides(),
            bool(current_app.config.get("DEMO_SEED")),
        )
        return jsonify(payload)

    @app.get("/api/monthend")
    def monthend():
        return jsonify(_month_payload())

    @app.get("/api/settings")
    def settings_get():
        return jsonify(public_settings())

    @app.post("/api/settings")
    def settings_save():
        body = _body()
        try:
            saved = save_settings(
                body.get("sync_webhook_url", ""),
                body.get("sync_webhook_key", ""),
                update_key="sync_webhook_key" in body and bool(str(body.get("sync_webhook_key") or "").strip()),
            )
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, settings=saved)

    @app.post("/api/monthend/sync")
    def monthend_sync():
        before = _month_payload()
        ok, status, error = request_month_end_sync()
        if error == "no_webhook":
            return jsonify(
                ok=False,
                error="no_webhook",
                message="No sync webhook is set. Add the URL and key in Settings.",
            ), 400
        if error == "invalid_url":
            return jsonify(ok=False, error="invalid_url", message="The sync webhook URL is not valid."), 400
        if not ok:
            return jsonify(
                ok=False,
                error="webhook_failed",
                status=status,
                message="Sync request failed" + (f" (HTTP {status})." if status else " (could not connect)."),
            ), 502
        return jsonify(
            ok=True,
            requested=True,
            last_synced=before.get("last_synced"),
            snapshot_id=before.get("snapshot_id"),
            message="Sync requested — your sheet will update in about a minute",
        )

    @app.post("/api/monthend/note")
    @app.post("/api/monthend/filenote")
    def monthend_note():
        body = _body()
        file_name = body.get("name") if request.path.endswith("filenote") else None
        try:
            _me().save_note(body.get("key", ""), body.get("text", ""), file_name=file_name)
        except KeyError:
            return jsonify(error="unknown task"), 400
        return jsonify(ok=True, monthend=_month_payload())

    @app.post("/api/monthend/completion")
    def monthend_completion():
        body = _body()
        moment = clock.now()
        try:
            task_key, month, status, date, note = parse_completion_request(
                body, MONTHS[moment.month - 1], moment.date().isoformat(), _me().registry(),
            )
            _me().set_completion(task_key, month, status, date=date, note=note, source="manual")
        except KeyError:
            return jsonify(error="unknown task"), 400
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, monthend=_month_payload())

    @app.post("/api/monthend/automation")
    def monthend_automation():
        body = _body()
        try:
            task_key = task_key_from(body, _me().registry())
            badge = parse_automation_badge(body.get("automation") or body.get("badge"))
            _me().set_automation(task_key, badge)
        except KeyError:
            return jsonify(error="unknown task"), 400
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, monthend=_month_payload())

    @app.post("/api/monthend/link")
    def monthend_link():
        body = _body()
        try:
            me = _me()
            task_key = task_key_from(body, me.registry())
            linked = me.link_line(task_key, body.get("link_to"))
            _db().retarget_task(linked["old_key"], linked["new_key"])
        except KeyError:
            return jsonify(error="unknown task"), 400
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, id=linked["id"], monthend=_month_payload())

    @app.get("/api/monthend/attachments/<att_id>")
    def monthend_attachment(att_id):
        try:
            path, content_type, _name = open_attachment(_me(), att_id)
            payload = path.read_bytes()
        except KeyError:
            return jsonify(error="unknown attachment"), 404
        resp = Response(payload, mimetype=content_type)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Content-Disposition"] = "inline"
        return resp

    @app.delete("/api/monthend/attachments/<att_id>")
    def monthend_attachment_delete(att_id):
        try:
            delete_attachment(_me(), att_id)
        except KeyError:
            return jsonify(error="unknown attachment"), 404
        return jsonify(ok=True, monthend=_month_payload())

    @app.post("/api/monthend/link/dismiss")
    def monthend_link_dismiss():
        body = _body()
        try:
            me = _me()
            task_key = task_key_from(body, me.registry())
            saved = me.dismiss_link(task_key)
        except KeyError:
            return jsonify(error="unknown task"), 400
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, id=saved["id"], dismissed=True, monthend=_month_payload())

    @app.post("/api/monthend/weeks")
    def monthend_weeks():
        body = _body()
        if "collapsed" not in body:
            return jsonify(error="collapsed true or false required"), 400
        try:
            saved = _me().set_week_collapsed(body.get("due", ""), bool(body.get("collapsed")))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, week_collapsed=saved)

    @app.post("/api/monthend/filereq")
    def monthend_filereq():
        body = _body()
        try:
            item = _me().add_file_req(body.get("key", ""), body.get("item") or {})
        except KeyError:
            return jsonify(error="unknown task"), 400
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, item=item, monthend=_month_payload())

    @app.post("/api/monthend/run")
    def monthend_run():
        body = _body()
        me = _me()
        task = me.task_by_key(body.get("key", ""))
        if not task:
            return jsonify(error="unknown task"), 400
        if task["ladder"] != "ready":
            return jsonify(error="this task is not on Run Now yet"), 400
        if _db().open_request_for(task["key"]):
            return jsonify(error="a run is already queued for this task"), 409
        month = body.get("month") or MONTHS[clock.now().month - 1]
        if month not in MONTHS:
            return jsonify(error="unknown month"), 400
        day = clock.now().date().isoformat()
        try:
            files = _save_files(task["key"], day, body.get("files") or [])
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        moment = clock.now()
        rid = "mr" + uuid.uuid4().hex[:12]
        actual = moment.strftime("%-I:%M %p")
        bot = task.get("bot") or "the bot"
        result = f"Queued at {actual}; waiting on {bot}."
        note = str(body.get("run_note") or "").strip()[:4000]
        standing = (task.get("note") or {}).get("text") or ""
        rec = _db().add_request({
            "id": rid,
            "task_key": task["key"],
            "task_name": task["task"],
            "row_num": task["row"],
            "bot": bot,
            "qbo": bool(task.get("qbo_write")),
            "log_month": month,
            "run_note": note,
            "standing_note": standing,
            "files": files,
            "status": "queued",
            "result": result,
            "day": day,
            "created_at": moment.isoformat(timespec="seconds"),
            "updated_at": moment.isoformat(timespec="seconds"),
        })
        detail = f"Asked {bot} to run it"
        if files:
            detail += ". Attached: " + ", ".join(f["name"] for f in files)
        if note:
            detail += ". Run note: " + note
        _db().add_run_log(rid, f"Row {task['row']}: {task['task']}", "Queued", detail)
        saved = [f["path"] for f in files]
        return jsonify(ok=True, id=rec["id"], saved=saved, monthend=_month_payload())

    @app.post("/api/monthend/requests/<rid>/decision")
    def monthend_decision(rid):
        rec = _db().get_request(rid)
        if not rec:
            return jsonify(error="unknown request"), 404
        if rec["status"] != "awaiting_approval":
            return jsonify(error="this run is not waiting for approval"), 409
        approve = bool(_body().get("approve"))
        name = f"Row {rec.get('row_num')}: {rec.get('task_name')}"
        if approve:
            result = "Approved. Waiting on the bot to finish. Nothing has been posted to QuickBooks yet."
            updated = _db().update_request(
                rid, status="approved", result=result, approved_at=clock.now().isoformat(timespec="seconds"),
            )
            _db().add_run_log(rid, name, "Approved", "You approved the QuickBooks write")
        else:
            result = "You rejected it. Nothing posted to QuickBooks, nothing written to the sheet."
            updated = _db().update_request(
                rid, status="failed", result=result, completed_at=clock.now().isoformat(timespec="seconds"),
            )
            _db().add_run_log(rid, name, "Rejected", result)
        return jsonify(ok=True, request={"id": updated["id"], "status": updated["status"]}, monthend=_month_payload())
