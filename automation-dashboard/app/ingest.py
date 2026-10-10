"""Token-authenticated endpoints for Luke's bots. Nothing here writes to Sheets or QuickBooks."""
import datetime

from flask import current_app, jsonify, request, send_file

from app import clock
from app.catalog import by_id
from app.month_end import done_text
from app.schedule import assign_slot, fmt_actual

RUN_STATUS = {
    "ok": "ok", "success": "ok", "succeeded": "ok", "done": "ok",
    "issue": "issue", "warning": "issue",
    "failed": "failed", "failure": "failed", "error": "failed",
    "missed": "missed",
}
COMPLETE_STATUS = {
    "succeeded": "succeeded", "success": "succeeded", "ok": "succeeded", "done": "succeeded",
    "failed": "failed", "failure": "failed", "error": "failed",
    "awaiting_approval": "awaiting_approval", "awaiting": "awaiting_approval",
}
PENDING = ("queued", "awaiting_approval", "approved")


def _json():
    if request.is_json:
        data = request.get_json(silent=True)
        return data if isinstance(data, dict) else {}
    return {}


def _db():
    return current_app.extensions["db"]


def _me():
    return current_app.extensions["month_end"]


def parse_ts(raw):
    text = str(raw or "").strip()
    if not text:
        raise ValueError("timestamp is required")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=clock.ET)
    return dt.astimezone(clock.ET)


def normalize_hm(raw):
    text = str(raw).strip()
    upper = text.upper()
    if upper.endswith("AM") or upper.endswith("PM"):
        hm, ap = upper.split()
        h, m = map(int, hm.split(":"))
        h = h % 12 + (12 if ap == "PM" else 0)
        return f"{h:02d}:{m:02d}"
    h, m = text.split(":")[:2]
    return f"{int(h):02d}:{int(m):02d}"


def resolve_slot(auto, ts, raw):
    sch = auto.get("schedule") or {}
    if sch.get("kind") not in ("daily", "weekdays", "dow", "month_days"):
        return None
    times = sch.get("times") or []
    if raw:
        try:
            norm = normalize_hm(raw)
        except (ValueError, IndexError):
            norm = None
        if norm in times:
            return norm
    return assign_slot(auto, ts)


def public_pending(rec):
    files = []
    for i, f in enumerate(rec.get("files") or []):
        files.append({
            "id": i,
            "name": f.get("name"),
            "need": f.get("need"),
            "file_note": f.get("file_note") or "",
            "size": f.get("size"),
            "type": f.get("type") or "",
            "download_path": f"/api/ingest/run-requests/{rec['id']}/files/{i}",
        })
    return {
        "id": rec["id"],
        "task_key": rec["task_key"],
        "task": rec.get("task_name"),
        "row": rec.get("row_num"),
        "bot": rec.get("bot"),
        "qbo_write": bool(rec.get("qbo")),
        "log_month": rec.get("log_month"),
        "run_note": rec.get("run_note") or "",
        "standing_note": rec.get("standing_note") or "",
        "status": rec["status"],
        "approved": rec["status"] == "approved" or bool(rec.get("approved_at")),
        "files": files,
        "created_at": rec["created_at"],
        "result": rec.get("result") or "",
    }


def register(app):
    @app.post("/api/ingest/runs")
    def ingest_run():
        body = _json()
        automation_id = body.get("automation_id") or body.get("id")
        auto = by_id().get(automation_id)
        if not auto:
            return jsonify(error="unknown automation id"), 400
        try:
            ts = parse_ts(body.get("timestamp") or body.get("ts"))
        except (ValueError, TypeError) as exc:
            return jsonify(error=str(exc)), 400
        status = RUN_STATUS.get(str(body.get("status") or "").strip().lower())
        if not status:
            return jsonify(error="status must be ok, issue, failed, or missed"), 400
        summary = str(body.get("summary") if body.get("summary") is not None else "")
        slot = resolve_slot(auto, ts, body.get("slot"))
        bot = str(body.get("bot") or auto["owner"])
        rec = _db().add_run(
            automation_id, bot, ts.isoformat(timespec="seconds"), ts.date().isoformat(),
            status, summary, slot, source="ingest",
        )
        app.logger.info("ingest run %s %s %s", automation_id, status, rec["day"])
        return jsonify(ok=True, run={
            "id": rec["id"],
            "automation_id": rec["automation_id"],
            "bot": rec["bot"],
            "timestamp": rec["ts"],
            "date": rec["day"],
            "status": rec["status"],
            "summary": rec["summary"],
            "slot": rec["slot"],
            "actual": fmt_actual(rec["ts"]),
        })

    @app.get("/api/ingest/run-requests")
    def list_requests():
        pending = [public_pending(r) for r in _db().all_requests() if r["status"] in PENDING]
        return jsonify(requests=pending)

    @app.get("/api/ingest/run-requests/<rid>")
    def get_request(rid):
        rec = _db().get_request(rid)
        if not rec:
            return jsonify(error="unknown request"), 404
        return jsonify(request=public_pending(rec))

    @app.get("/api/ingest/run-requests/<rid>/files/<int:file_id>")
    def download_file(rid, file_id):
        rec = _db().get_request(rid)
        if not rec:
            return jsonify(error="unknown request"), 404
        files = rec.get("files") or []
        if file_id < 0 or file_id >= len(files):
            return jsonify(error="unknown file"), 404
        rel = files[file_id].get("path") or ""
        root = (current_app.config["DATA_DIR_PATH"] / "uploads").resolve()
        path = (current_app.config["DATA_DIR_PATH"] / rel).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            return jsonify(error="unknown file"), 404
        if not path.is_file():
            return jsonify(error="file missing"), 404
        return send_file(path, as_attachment=True, download_name=files[file_id].get("name") or "file")

    @app.post("/api/ingest/run-requests/<rid>/complete")
    def complete(rid):
        rec = _db().get_request(rid)
        if not rec:
            return jsonify(error="unknown request"), 404
        if rec["status"] in ("succeeded", "failed"):
            return jsonify(error="request is already finished"), 409
        body = _json()
        status = COMPLETE_STATUS.get(str(body.get("status") or "").strip().lower())
        if not status:
            return jsonify(error="status must be succeeded, failed, or awaiting_approval"), 400
        notes = str(body.get("notes") if body.get("notes") is not None else body.get("summary") or "").strip()
        done = str(body.get("done_date") or rec.get("done_date") or "").strip()
        if done:
            try:
                datetime.date.fromisoformat(done)
            except ValueError:
                return jsonify(error="done_date must be YYYY-MM-DD"), 400
        if status == "succeeded" and not done:
            done = clock.now().date().isoformat()
        text = done_text(done) if done else None
        db = _db()
        name = f"Row {rec.get('row_num')}: {rec.get('task_name')}"

        if status == "failed":
            result = notes or "Failed. Nothing was written to the sheet or QuickBooks."
            updated = db.update_request(
                rid, status="failed", result=result, completion_notes=notes,
                done_date=done or None, done_text=text, completed_at=clock.now().isoformat(timespec="seconds"),
            )
            db.add_run_log(rid, name, "Failed", result)
            return jsonify(ok=True, request=public_pending(updated))

        if status == "awaiting_approval" or (status == "succeeded" and rec.get("qbo") and rec["status"] != "approved"):
            result = "Awaiting your approval before the QuickBooks write."
            if notes:
                result = result + " " + notes
            updated = db.update_request(
                rid, status="awaiting_approval", result=result, completion_notes=notes,
                done_date=done or None, done_text=text,
            )
            db.add_run_log(rid, name, "Awaiting your approval", result)
            return jsonify(ok=True, request=public_pending(updated), held_for_approval=True)

        result = notes or f"Completed. Done date {text} logged under {rec.get('log_month') or 'the run month'}."
        updated = db.update_request(
            rid, status="succeeded", result=result, completion_notes=notes,
            done_date=done, done_text=text, completed_at=clock.now().isoformat(timespec="seconds"),
        )
        db.add_run_log(rid, name, "Succeeded", result)
        return jsonify(ok=True, request=public_pending(updated))

    @app.post("/api/ingest/month-end")
    def ingest_month_end():
        me = _me()
        try:
            if request.content_type and "text/csv" in request.content_type:
                csv_text = request.get_data(as_text=True)
            else:
                body = request.get_json(silent=True)
                if isinstance(body, dict) and isinstance(body.get("csv"), str):
                    csv_text = body["csv"]
                elif isinstance(body, dict) and isinstance(body.get("rows"), list):
                    from app.month_end import rows_to_csv
                    csv_text = rows_to_csv(body["rows"])
                else:
                    return jsonify(error="send text/csv, {csv}, or {rows}"), 400
            if not csv_text.strip():
                return jsonify(error="empty snapshot"), 400
            payload = me.save_snapshot(csv_text)
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        changes = payload["changes"]
        return jsonify(
            ok=True,
            changes=changes,
            tasks=len(payload["tasks"]),
            removed=len(payload["removed"]),
            last_synced=payload["last_synced"],
        )
