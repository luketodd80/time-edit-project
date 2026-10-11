"""Token-authenticated endpoints for Luke's bots. Nothing here writes to Sheets or QuickBooks."""
import datetime
import json

from flask import current_app, jsonify, request, send_file

from app import clock
from app.attachments import add_attachment, list_attachments, parse_month, read_image
from app.vehicle_lease import UnitExists
from app.catalog import by_id
from app.month_end import MONTHS, decorate, done_text, parse_automation_badge, parse_completion_request, task_key_from
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

    @app.post("/api/ingest/month-end/status")
    def ingest_month_end_status():
        """Mark a checklist task done (or another status) by task name and due. Does not write the sheet."""
        body = _json()
        moment = clock.now()
        me = _me()
        try:
            task_key, month, status, date, note = parse_completion_request(
                body, MONTHS[moment.month - 1], moment.date().isoformat(), me.registry(),
            )
            me.set_completion(task_key, month, status, date=date, note=note, source="bot")
        except KeyError:
            return jsonify(error="unknown task"), 404
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        payload = decorate(me.load_and_sync(), _db().all_requests())
        task = next((t for t in payload["tasks"] if t["key"] == task_key), None)
        completion = (task or {}).get("completion", {}).get(month)
        return jsonify(
            ok=True,
            id=task.get("me_id") if task else None,
            task=task["task"] if task else body.get("task"),
            due=task["due"] if task else body.get("due"),
            month=month,
            completion=completion,
        )

    @app.post("/api/ingest/month-end/automation")
    def ingest_month_end_automation():
        """Set a task's automation badge by task name and due. Does not write the sheet."""
        body = _json()
        me = _me()
        try:
            task_key = task_key_from(body, me.registry())
            badge = parse_automation_badge(body.get("automation") or body.get("badge"))
            me.set_automation(task_key, badge)
        except KeyError:
            return jsonify(error="unknown task"), 404
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        payload = decorate(me.load_and_sync(), _db().all_requests())
        task = next((t for t in payload["tasks"] if t["key"] == task_key), None)
        return jsonify(
            ok=True,
            id=task.get("me_id") if task else None,
            task=task["task"] if task else body.get("task"),
            due=task["due"] if task else body.get("due"),
            automation=task["automation"] if task else badge,
            ladder=task["ladder"] if task else None,
        )

    def _task_brief(task, month):
        completion = (task.get("completion") or {}).get(month) or {}
        note = task.get("note") or {}
        return {
            "id": task.get("me_id"),
            "task": task.get("task"),
            "due": task.get("due"),
            "badge": task.get("automation"),
            "status": completion.get("status") or "not_started",
            "notes": note.get("text") or "",
        }

    @app.get("/api/ingest/month-end/tasks")
    def ingest_month_end_tasks():
        """List month-end tasks by permanent id. Includes lines removed from the sheet."""
        moment = clock.now()
        month = MONTHS[moment.month - 1]
        payload = decorate(_me().load_and_sync(), _db().all_requests())
        return jsonify(
            ok=True,
            month=month,
            tasks=[_task_brief(t, month) for t in payload["tasks"]],
            removed=[_task_brief(t, month) for t in payload["removed"]],
        )

    @app.post("/api/ingest/month-end/link")
    def ingest_month_end_link():
        """Give a new sheet line the permanent id of a task that just left the sheet."""
        body = _json()
        me = _me()
        try:
            task_key = task_key_from(body, me.registry())
            linked = me.link_line(task_key, body.get("link_to"))
            _db().retarget_task(linked["old_key"], linked["new_key"])
        except KeyError:
            return jsonify(error="unknown task"), 404
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        payload = decorate(me.load_and_sync(), _db().all_requests())
        task = next((t for t in payload["tasks"] if t["key"] == linked["new_key"]), None)
        return jsonify(
            ok=True,
            id=task.get("me_id") if task else linked["id"],
            task=task["task"] if task else None,
            due=task["due"] if task else None,
            badge=task.get("automation") if task else None,
        )

    @app.post("/api/ingest/month-end/link/dismiss")
    def ingest_month_end_link_dismiss():
        """Hide the link suggestion for a new line until its task name or due changes."""
        body = _json()
        me = _me()
        try:
            task_key = task_key_from(body, me.registry())
            saved = me.dismiss_link(task_key)
        except KeyError:
            return jsonify(error="unknown task"), 404
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, id=saved["id"], task=saved["task"], due=saved["due"], dismissed=True)

    def _attachment_target():
        """Resolve id (or task + due) and YYYY-MM from a multipart form or query string."""
        body = {
            "id": request.form.get("id") or request.args.get("id"),
            "me_id": request.form.get("me_id") or request.args.get("me_id"),
            "task": request.form.get("task") or request.args.get("task"),
            "due": request.form.get("due") if "due" in request.form else request.args.get("due"),
            "key": request.form.get("key") or request.args.get("key"),
        }
        me = _me()
        task_key = task_key_from(body, me.registry())
        month = parse_month(request.form.get("month") or request.args.get("month"))
        return me, task_key, month

    @app.post("/api/ingest/month-end/attachment")
    def ingest_month_end_attachment():
        """Store a PNG, JPEG, or PDF on a task's history for one month. Several are allowed."""
        me = _me()
        if request.content_length and request.content_length > 10 * 1024 * 1024 + 256 * 1024:
            return jsonify(error="file is over 10 MB"), 400
        try:
            me, task_key, month = _attachment_target()
            raw, content_type, ext, name = read_image(request.files.get("file"))
            saved = add_attachment(
                me, task_key, month, raw, content_type, ext, name, request.form.get("caption"),
            )
        except KeyError:
            return jsonify(error="unknown task"), 404
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        payload = decorate(me.load_and_sync(), _db().all_requests())
        task = next((t for t in payload["tasks"] + payload["removed"] if t["key"] == task_key), None)
        return jsonify(
            ok=True,
            id=task.get("me_id") if task else None,
            task=task.get("task") if task else None,
            due=task.get("due") if task else None,
            month=month,
            attachment=saved,
        )

    @app.get("/api/ingest/month-end/attachments")
    def ingest_month_end_attachments():
        """List files stored for one task and month. The files themselves need a logged-in session."""
        try:
            me, task_key, month = _attachment_target()
            items = list_attachments(me, task_key, month)
        except KeyError:
            return jsonify(error="unknown task"), 404
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        payload = decorate(me.load_and_sync(), _db().all_requests())
        task = next((t for t in payload["tasks"] + payload["removed"] if t["key"] == task_key), None)
        listed = [{k: v for k, v in item.items() if k != "url"} for item in items]
        return jsonify(
            ok=True,
            id=task.get("me_id") if task else None,
            task=task.get("task") if task else None,
            due=task.get("due") if task else None,
            month=month,
            attachments=listed,
        )

    @app.get("/api/ingest/month-end/writebacks")
    def ingest_month_end_writebacks():
        """List sheet write-backs queued when someone marks Done on the dashboard."""
        status = " ".join(str(request.args.get("status") or "pending").split()).lower()
        allowed = {"pending", "written", "skipped", "flagged", "cancelled", "all"}
        if status not in allowed:
            return jsonify(error="status must be pending, written, skipped, flagged, cancelled, or all"), 400
        return jsonify(ok=True, writebacks=_me().list_writebacks(status))

    @app.post("/api/ingest/month-end/writebacks/<writeback_id>/result")
    def ingest_month_end_writeback_result(writeback_id):
        """Record that the sheet routine wrote, skipped, or flagged a queued Done."""
        body = _json()
        try:
            saved = _me().finish_writeback(writeback_id, body.get("status"), body.get("note"))
        except KeyError:
            return jsonify(error="unknown write-back"), 404
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, writeback=saved)

    def _vl():
        return current_app.extensions["vehicle_lease"]

    def _lease_upload(name):
        upload = request.files.get(name)
        if upload is None:
            raise ValueError(f"{name} file is required")
        payload = upload.read(15 * 1024 * 1024 + 1)
        if not payload:
            raise ValueError(f"{name} file is empty")
        if len(payload) > 15 * 1024 * 1024:
            raise ValueError(f"{name} is over 15 MB")
        return payload

    def _lease_fields():
        raw = request.form.get("payload")
        if raw:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                raise ValueError("payload must be JSON")
            if not isinstance(data, dict):
                raise ValueError("payload must be a JSON object")
            return data
        branches = request.form.get("branches")
        if branches:
            try:
                branches = json.loads(branches)
            except json.JSONDecodeError:
                raise ValueError("branches must be JSON")
        return {
            "total": request.form.get("total"),
            "active_units": request.form.get("active_units"),
            "branches": branches or {},
            "fleet_check": request.form.get("fleet_check"),
            "fleet_status": request.form.get("fleet_status"),
            "qbo_je": request.form.get("qbo_je"),
        }

    @app.get("/api/ingest/vehicle-lease/registry")
    def ingest_vehicle_lease_registry():
        state = _vl().state()
        return jsonify(ok=True, vehicles=state["vehicles"], settings=state["settings"])

    @app.get("/api/ingest/vehicle-lease/ignored")
    def ingest_vehicle_lease_ignored():
        return jsonify(ok=True, ignored=_vl().state()["ignored"])

    def _ignored_units(raw):
        if isinstance(raw, list):
            return raw
        if isinstance(raw, str):
            return [raw]
        if not isinstance(raw, dict):
            raise ValueError("unit is required")
        if "units" in raw:
            value = raw["units"]
        elif "unit" in raw:
            value = raw["unit"]
        elif "ignored" in raw:
            value = raw["ignored"]
        else:
            raise ValueError("unit is required")
        if isinstance(value, list):
            return value
        return [value]

    @app.post("/api/ingest/vehicle-lease/registry")
    def ingest_vehicle_lease_add():
        try:
            saved = _vl().save_vehicle(_json())
        except UnitExists as exc:
            return jsonify(error=str(exc)), 409
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, vehicle=saved)

    @app.patch("/api/ingest/vehicle-lease/registry/<unit>")
    def ingest_vehicle_lease_edit(unit):
        try:
            saved = _vl().update_by_unit(unit, _json())
        except UnitExists as exc:
            return jsonify(error=str(exc)), 409
        except KeyError:
            return jsonify(error="unknown unit"), 404
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, vehicle=saved)

    @app.delete("/api/ingest/vehicle-lease/registry/<unit>")
    def ingest_vehicle_lease_remove(unit):
        try:
            removed = _vl().delete_by_unit(unit)
        except KeyError:
            return jsonify(error="unknown unit"), 404
        return jsonify(ok=True, unit=removed)

    @app.post("/api/ingest/vehicle-lease/ignored")
    def ingest_vehicle_lease_ignore():
        raw = request.get_json(silent=True) if request.is_json else None
        try:
            added, ignored = _vl().add_ignored(_ignored_units(raw))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, added=added, ignored=ignored)

    @app.delete("/api/ingest/vehicle-lease/ignored/<unit>")
    def ingest_vehicle_lease_unignore(unit):
        try:
            removed, ignored = _vl().remove_ignored(unit)
        except KeyError:
            return jsonify(error="unknown unit"), 404
        return jsonify(ok=True, unit=removed, ignored=ignored)

    @app.post("/api/ingest/vehicle-lease/runs")
    def ingest_vehicle_lease_run():
        try:
            fields = _lease_fields()
            saved = _vl().store_upload(
                request.form.get("month") or fields.get("month"),
                fields,
                _lease_upload("je"),
                _lease_upload("pdf"),
                _lease_upload("detail"),
            )
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, run=saved)

    @app.patch("/api/ingest/vehicle-lease/runs/<month>")
    def ingest_vehicle_lease_qbo(month):
        body = _json()
        try:
            saved = _vl().set_qbo(month, body.get("qbo_je"))
        except KeyError:
            return jsonify(error="unknown run"), 404
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, run=saved)
