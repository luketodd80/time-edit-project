"""Build one day's board from the catalog schedule plus recorded runs."""
import datetime

from app.catalog import ALL_BOTS, annotated, apply_override
from app.demo import extras, lookup

PENDING_RESULT = "No report yet"
MISSED_RESULT = "Missed"
NO_RUNS = "No runs this day"
WEEKEND_RESULT = "Not scheduled (weekend)"


def fmt_hm(hm):
    h, m = map(int, hm.split(":"))
    ap = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d} {ap}"


def to_min(hm):
    h, m = map(int, hm.split(":"))
    return h * 60 + m


def fmt_actual(ts_iso):
    dt = datetime.datetime.fromisoformat(ts_iso)
    h = dt.hour
    ap = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    return f"{h12}:{dt.minute:02d} {ap}"


def fmt_last_run(ts_iso):
    dt = datetime.datetime.fromisoformat(ts_iso)
    h = dt.hour
    ap = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    return f"{dt.strftime('%b')} {dt.day}, {h12}:{dt.minute:02d} {ap}"


def _blank_row(auto, time, sort, key, kind, freq=None):
    return {
        "key": key,
        "id": auto["id"],
        "bot": auto["owner"],
        "name": auto["name"],
        "time": time,
        "sort": sort,
        "freq": freq,
        "kind": kind,
        "ran": "pending",
        "outcome": "pending",
        "actual": None,
        "result": PENDING_RESULT,
        "flag": auto.get("flag"),
        "trigger": auto["trigger"],
        "delivers_to": auto["delivers_to"],
        "does": auto["does"],
    }


def _apply_status(row, status, summary, actual):
    summary = summary or ""
    if status == "ok":
        row.update(ran="yes", outcome="ok", actual=actual, result=summary or "Succeeded")
    elif status == "issue":
        row.update(ran="yes", outcome="issue", actual=actual, result=summary or "Ran with an issue")
    elif status == "unknown":
        row.update(ran="unknown", outcome="unknown", actual=actual, result=summary or "Unknown")
    else:
        row.update(ran="missed", outcome="missed", actual=actual, result=summary or MISSED_RESULT)
    return row


def _from_live(row, rec):
    actual = fmt_actual(rec["ts"]) if rec.get("ts") else None
    return _apply_status(row, rec["status"], rec.get("summary"), actual)


def _from_demo(row, rec):
    return _apply_status(row, rec["status"], rec.get("summary"), rec.get("actual"))


def assign_slot(auto, ts):
    """Point-in-time jobs get the closest scheduled clock time. Windows and webhooks do not."""
    sch = auto.get("schedule") or {}
    kind = sch.get("kind")
    if kind not in ("daily", "weekdays", "dow", "month_days"):
        return None
    times = sch.get("times") or []
    if not times:
        return None
    if len(times) == 1:
        return times[0]
    hm = f"{ts.hour:02d}:{ts.minute:02d}"
    return min(times, key=lambda t: abs(to_min(t) - to_min(hm)))


def _started(auto, day):
    start = auto.get("active_from")
    return not (start and day < datetime.date.fromisoformat(start))


def _dow_match(sch, day):
    kind = sch.get("kind")
    wd = day.weekday()
    weekend = wd >= 5
    if kind == "daily":
        return True, False
    if kind == "weekdays":
        return (not weekend), weekend
    if kind == "dow":
        return wd in sch.get("days", []), False
    if kind == "month_days":
        return day.day in sch.get("days", []), False
    if kind == "window":
        if sch.get("weekdays") and weekend:
            return False, True
        return True, False
    return False, False


def _point_specs(auto, day):
    """Return ('run'|'weekend', hm, key) for a point-time automation."""
    sch = auto["schedule"]
    runs, weekend = _dow_match(sch, day)
    times = sch.get("times") or []
    keys = sch.get("keys") or []
    if runs and not _started(auto, day):
        return []
    specs = []
    for i, hm in enumerate(times):
        key = keys[i] if i < len(keys) else (auto["id"] if len(times) == 1 else f"{auto['id']}-{hm}")
        if runs:
            specs.append(("run", hm, key))
        elif weekend:
            specs.append(("weekend", hm, key))
    return specs


def _window_spec(auto, day):
    sch = auto["schedule"]
    runs, weekend = _dow_match(sch, day)
    anchor = sch.get("anchor") or sch.get("start") or "00:00"
    label = sch.get("label")
    display = sch.get("display") or fmt_hm(anchor)
    sort = sch.get("sort", to_min(anchor))
    if weekend:
        return ("weekend", anchor, auto["id"], display, sort, label)
    if runs and _started(auto, day):
        return ("run", anchor, auto["id"], display, sort, label)
    return None


def _fill_point(row, day, today, now, hm, live, demo_on):
    if live:
        return _from_live(row, max(live, key=lambda r: (r["ts"], r["id"])))
    if demo_on:
        demo = lookup(day.isoformat(), row["id"], hm)
        if demo:
            return _from_demo(row, demo[-1])
    due = datetime.datetime.combine(day, datetime.time.fromisoformat(hm), tzinfo=now.tzinfo)
    if day > today or now < due:
        row.update(ran="pending", outcome="pending", result=PENDING_RESULT, actual=None)
    else:
        row.update(ran="missed", outcome="missed", result=MISSED_RESULT, actual=None)
    return row


def _fill_window(row, day, today, now, start_hm, end_hm, live, demo_on):
    if live:
        return _from_live(row, max(live, key=lambda r: (r["ts"], r["id"])))
    if demo_on:
        demo = lookup(day.isoformat(), row["id"], None)
        if demo:
            return _from_demo(row, demo[-1])
    start = datetime.datetime.combine(day, datetime.time.fromisoformat(start_hm), tzinfo=now.tzinfo)
    end = datetime.datetime.combine(day, datetime.time.fromisoformat(end_hm), tzinfo=now.tzinfo)
    if day > today or now < start or (day == today and now <= end):
        row.update(ran="pending", outcome="pending", result=PENDING_RESULT, actual=None)
    else:
        row.update(ran="missed", outcome="missed", result=MISSED_RESULT, actual=None)
    return row


def _webhook_rows(auto, day, today, live, demo_on):
    recs = list(live)
    if not recs and demo_on:
        recs = lookup(day.isoformat(), auto["id"], None)
    if not recs:
        row = _blank_row(auto, "On demand", 9999, auto["id"], "webhook")
        if day > today:
            row.update(ran="pending", outcome="pending", result=PENDING_RESULT)
        else:
            row.update(ran="none", outcome="none", actual=None, result=NO_RUNS)
        return [row]
    out = []
    for rec in recs:
        row = _blank_row(auto, "On demand", 9999, f"{auto['id']}-{rec.get('id', 'd')}", "webhook")
        if "ts" in rec:
            _from_live(row, rec)
        else:
            _from_demo(row, rec)
        out.append(row)
    return out


def _live_for(runs, automation_id, slot):
    matched = []
    for rec in runs:
        if rec["automation_id"] != automation_id:
            continue
        if slot is None:
            if not rec.get("slot"):
                matched.append(rec)
        elif rec.get("slot") == slot:
            matched.append(rec)
    return matched


def _request_row(req):
    state = req["status"]
    if state in ("queued", "awaiting_approval", "approved"):
        ran, outcome = "pending", "pending"
    elif state == "succeeded":
        ran, outcome = "yes", "ok"
    else:
        ran, outcome = "missed", "missed"
    bot = (req.get("bot") or "").split(" /")[0] or req.get("bot")
    return {
        "key": req["id"],
        "id": req["id"],
        "bot": bot,
        "name": f"Month-end: {req.get('task_name') or req['task_key']}",
        "time": "On demand",
        "sort": 9999,
        "freq": "Kicked off by Luke",
        "kind": "webhook",
        "ran": ran,
        "outcome": outcome,
        "actual": fmt_actual(req["created_at"]) if req.get("created_at") else None,
        "result": req.get("result") or state,
        "flag": None,
        "trigger": "Run Now on the On demand / Month-end tab",
        "delivers_to": "Luke",
        "does": f"Logs under {req.get('log_month') or 'the run month'}.",
    }


def _idle_note(bot, day, autos, rows):
    note = None
    for auto in autos:
        if auto["owner"] != bot or auto["status"] != "active":
            continue
        start = auto.get("active_from")
        if auto.get("before_note") and start and day < datetime.date.fromisoformat(start) and day.weekday() < 5:
            return auto["before_note"]
        if auto.get("board_note") and not note:
            note = auto["board_note"]
    if note:
        return note
    if any(r["bot"] == bot for r in rows):
        return "on-demand webhook only"
    return None


def summarize(rows):
    sched = [r for r in rows if r["kind"] == "schedule"]

    def c(o):
        return sum(1 for r in rows if r["outcome"] == o)

    return {
        "scheduled": len(sched),
        "ok": c("ok"),
        "issue": c("issue"),
        "missed": c("missed"),
        "pending": c("pending"),
        "unknown": c("unknown"),
    }


def build_day(day, today, now, runs, requests, overrides, demo):
    autos = []
    for item in annotated():
        autos.append(apply_override(item, overrides.get(item["id"])))
    by = {a["id"]: a for a in autos}
    rows = []
    weekend = []
    matched = set()

    for auto in autos:
        if auto["status"] != "active":
            continue
        sch = auto.get("schedule") or {"kind": "none"}
        kind = sch.get("kind")
        if kind in ("none", None):
            continue
        if kind == "webhook":
            live = _live_for(runs, auto["id"], None)
            matched.update(r["id"] for r in live)
            rows.extend(_webhook_rows(auto, day, today, live, demo))
            continue
        if kind == "window":
            spec = _window_spec(auto, day)
            if not spec:
                continue
            where, anchor, key, display, sort, label = spec
            if where == "weekend":
                row = _blank_row(auto, fmt_hm(anchor) if not sch.get("display") else display, sort, key, "schedule", label)
                row.update(ran="ns", outcome="ns", actual=None, result=WEEKEND_RESULT)
                weekend.append(row)
                continue
            row = _blank_row(auto, display, sort, key, "schedule", label)
            live = _live_for(runs, auto["id"], None)
            matched.update(r["id"] for r in live)
            rows.append(_fill_window(row, day, today, now, sch["start"], sch["end"], live, demo))
            continue
        for where, hm, key in _point_specs(auto, day):
            if where == "weekend":
                row = _blank_row(auto, fmt_hm(hm), to_min(hm), key, "schedule")
                row.update(ran="ns", outcome="ns", actual=None, result=WEEKEND_RESULT)
                weekend.append(row)
                continue
            row = _blank_row(auto, fmt_hm(hm), to_min(hm), key, "schedule")
            live = _live_for(runs, auto["id"], hm)
            matched.update(r["id"] for r in live)
            rows.append(_fill_point(row, day, today, now, hm, live, demo))

    for rec in runs:
        if rec["id"] in matched:
            continue
        auto = by.get(rec["automation_id"])
        if not auto:
            continue
        row = _blank_row(auto, "On demand", 9999, f"extra-{rec['id']}", "webhook")
        rows.append(_from_live(row, rec))

    for req in requests:
        if req.get("day") == day.isoformat():
            rows.append(_request_row(req))

    if demo:
        rows.extend(extras(day.isoformat()))

    rows.sort(key=lambda r: (r["sort"], str(r["key"])))
    active = {r["bot"] for r in rows if r["kind"] == "schedule"}
    idle = []
    for bot in ALL_BOTS:
        if bot in active:
            continue
        idle.append({"bot": bot, "note": _idle_note(bot, day, autos, rows)})
    if day == today:
        state = "today"
    elif day > today:
        state = "planned"
    else:
        state = "past"
    return {
        "date": day.isoformat(),
        "label": day.strftime("%a %b ") + str(day.day) + day.strftime(", %Y"),
        "weekday": day.weekday(),
        "is_today": day == today,
        "today": today.isoformat(),
        "state": state,
        "rows": rows,
        "weekend": weekend,
        "idle": idle,
        "summary": summarize(rows),
    }
