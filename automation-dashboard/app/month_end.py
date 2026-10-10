"""Month-end checklist.

Source: Google Sheet 'Shared Accounting' > 'Month End- 2026'.
This app never writes to the sheet or to QuickBooks. A bot may POST a fresh
snapshot; sync() diffs it by Task name + Due (not row number).

New sheet tasks arrive as Manual with a New tag. Tasks that disappear go to
the Removed-from-sheet list. Notes, file requirements, and run history stay
on the task key.
"""
import csv
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path

from app.clock import now

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
COLS = "GHIJKLMNOPQR"  # G = January ... R = December
DUE_ORDER = ["1st week", "2nd Week", "3rd Week", "4th Week", "End of Month", "Weekly", "Monthly", "Yearly"]
CAND_LABEL = {
    "run": "Grok can run",
    "prep": "Grok can prep, you approve",
    "claude": "Claude today, candidate to move",
}
HEADERS = [
    "Due", "Order", "Category", "Task", "Notes/ Questions", "Assigned To", *MONTHS,
]
SNAPSHOT_READ = "2026-10-10T16:03:00-04:00"
SEEDED_AT = "2026-10-10T15:05:00-04:00"

SEED_FILES = ("month_end_2026.csv", "month_end_registry.json", "month_end_candidates.json")


def key(task, due):
    return " ".join(task.split()).lower() + "|" + " ".join(due.split()).lower()


K13 = key("Update Perform Shared Resources Spreadsheet", "2nd Week")
K14 = key("Create JE for Shared Resources", "2nd Week")
K12 = key("Payroll Report", "2nd Week")

LADDER = {
    K13: {
        "ladder": "ready", "bot": "Grok Bot / Month-End", "qbo_write": False,
        "detail": "Uses the Bamboo payroll export, copies the Template tab to 'September 2026', and fills B6:G34.",
    },
    K14: {
        "ladder": "ready", "bot": "Don", "qbo_write": True,
        "detail": "QBO JE 1577158 'PR-SEP-2026-SR', dated 9/30/2026, $50,111.96, posted by Don with Luke's approval.",
    },
}
FILES = {
    K13: {
        "needs": [{
            "name": "Bamboo payroll report (Month-to-Date, all pay schedules)",
            "hint": "BambooHR report export with First/Last Name, Total Gross Wage, Location Name, Department Name; Amber can pull it",
            "types": [".xlsx"], "required": True,
            "last_used": "The September report, uploaded Oct 10",
        }],
    },
    K12: {"outputs": ["Bamboo payroll report"]},
    K14: {"note": "No upload: uses row 13's sheet tab ('September 2026')."},
}
HISTORY = {
    K13: [{
        "date": "2026-10-10", "time": "~3:50 PM", "by": "Luke", "state": "succeeded", "month": "October",
        "result": "Copied Template to 'September 2026' and filled B6:G34 from the Bamboo payroll export. Sheet shows 10/10 in P13.",
        "files": ["September Bamboo payroll report (uploaded Oct 10)"],
    }],
    K14: [{
        "date": "2026-10-10", "time": "~3:55 PM", "by": "Luke", "state": "succeeded", "month": "October",
        "result": "Don posted QBO JE 1577158 'PR-SEP-2026-SR' (9/30/2026, $50,111.96) with Luke's approval. Sheet shows 10/10 in P14.",
    }],
}


def _status(v):
    v = (v or "").strip()
    if not v:
        return {"kind": "open", "text": "Open"}
    if v.lower() in ("na", "n/a"):
        return {"kind": "na", "text": "N/A"}
    if v.lower() == "no longer used":
        return {"kind": "na", "text": "No longer used"}
    if v.lower() != "done" and not any(ch.isdigit() for ch in v):
        return {"kind": "note", "text": v}
    return {"kind": "done", "text": v}


def read_sheet(path):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.reader(fh))
    out = []
    for i, r in enumerate(rows[1:], 2):
        r = r + [""] * (18 - len(r))
        if not r[3].strip():
            continue
        out.append({
            "row": i,
            "key": key(r[3], r[0]),
            "due": r[0].strip(),
            "order": int(r[1]) if r[1].strip().isdigit() else None,
            "category": r[2].strip(),
            "task": " ".join(r[3].split()),
            "notes": " ".join(r[4].split()),
            "assigned": r[5].strip(),
            "months": {m: _status(r[6 + k]) for k, m in enumerate(MONTHS)},
        })
    return out


def rows_to_csv(rows):
    """Accept a CSV string, a list of lists, or a list of header-keyed objects."""
    if isinstance(rows, str):
        return rows
    import io
    sio = io.StringIO()
    writer = csv.writer(sio)
    if rows and isinstance(rows[0], dict):
        writer.writerow(HEADERS)
        for row in rows:
            writer.writerow([row.get(h, "") for h in HEADERS])
    else:
        for row in rows:
            writer.writerow(row)
    return sio.getvalue()


def done_text(iso_date):
    d = datetime.date.fromisoformat(iso_date)
    return f"{d.month}/{d.day}"


def month_name(iso_date):
    d = datetime.date.fromisoformat(iso_date)
    return MONTHS[d.month - 1]


def fmt_ts(iso):
    try:
        dt = datetime.datetime.fromisoformat(iso)
    except ValueError:
        return iso
    h = dt.hour
    ap = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    return f"{dt.strftime('%b')} {dt.day}, {h12}:{dt.minute:02d} {ap} ET"


class MonthEnd:
    def __init__(self, data_dir, seed_dir):
        self.data_dir = Path(data_dir)
        self.seed_dir = Path(seed_dir)
        self.sheet = self.data_dir / "month_end_2026.csv"
        self.registry_path = self.data_dir / "month_end_registry.json"
        self.candidates_path = self.data_dir / "month_end_candidates.json"
        self.lock_path = self.data_dir / "month_end.lock"
        self.ensure_seeded()

    def ensure_seeded(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "uploads").mkdir(exist_ok=True)
        (self.data_dir / "sheet_snapshots").mkdir(exist_ok=True)
        for name in SEED_FILES:
            dest = self.data_dir / name
            if not dest.exists():
                src = self.seed_dir / name
                dest.write_bytes(src.read_bytes())

    def _read_reg(self):
        if not self.registry_path.exists():
            return {"seeded_at": SEEDED_AT, "tasks": {}, "snapshot_read": SNAPSHOT_READ}
        reg = json.loads(self.registry_path.read_text(encoding="utf-8"))
        reg.setdefault("tasks", {})
        reg.setdefault("seeded_at", SEEDED_AT)
        reg.setdefault("snapshot_read", SNAPSHOT_READ)
        return reg

    def _write_reg(self, reg):
        tmp = self.registry_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(reg, indent=1), encoding="utf-8")
        os.replace(tmp, self.registry_path)

    def _locked(self, fn):
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.lock_path, "a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                return fn()
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def candidates(self):
        return json.loads(self.candidates_path.read_text(encoding="utf-8"))

    def sync(self, path=None, now_dt=None):
        path = Path(path or self.sheet)

        def run():
            now_s = (now_dt or now()).isoformat(timespec="seconds")
            reg = self._read_reg()
            sheet = read_sheet(path)
            seen = set()
            added, removed, back = [], [], []
            for t in sheet:
                seen.add(t["key"])
                entry = reg["tasks"].get(t["key"])
                if entry is None:
                    first = reg["seeded_at"] if not reg["tasks"] else now_s
                    entry = reg["tasks"][t["key"]] = {"first_seen": first}
                    if first != reg["seeded_at"]:
                        added.append(t["task"])
                if entry.get("removed_at"):
                    back.append(t["task"])
                    entry["removed_at"] = None
                entry.update(
                    task=t["task"], due=t["due"], assigned=t["assigned"],
                    last_row=t["row"], last_seen=now_s,
                )
            for k, entry in reg["tasks"].items():
                if k not in seen and not entry.get("removed_at"):
                    entry["removed_at"] = now_s
                    removed.append(entry.get("task"))
            reg["last_synced"] = now_s
            self._write_reg(reg)
            return reg, sheet, {"added": added, "removed": removed, "restored": back}

        return self._locked(run)

    def files_for(self, k, reg):
        base = FILES.get(k, {})
        custom = reg.get("file_reqs", {}).get(k, [])
        fn = reg.get("file_notes", {}).get(k, {})
        needs = [dict(n, note=fn.get(n["name"])) for n in base.get("needs", []) + custom]
        return {
            "needs": needs,
            "outputs": base.get("outputs", []),
            "note": base.get("note"),
            "seeded": k in FILES,
            "custom_count": len(custom),
        }

    def build(self, reg, sheet, changes=None):
        cands = self.candidates()
        tasks = []
        for t in sheet:
            entry = reg["tasks"][t["key"]]
            cand = cands.get(t["key"])
            ladder = LADDER.get(t["key"], {})
            cand_use = cand if cand and cand.get("badge") != "manual" else None
            tasks.append({
                **t,
                "id": "me-" + hashlib.md5(t["key"].encode()).hexdigest()[:10],
                "ladder": ladder.get("ladder", "manual"),
                "new": entry["first_seen"] != reg["seeded_at"],
                "first_seen": entry["first_seen"],
                "candidate": CAND_LABEL[cand_use["badge"]] if cand_use else None,
                "bot": ladder.get("bot") or (cand_use["bot"] if cand_use else None),
                "qbo_write": ladder.get("qbo_write", bool(cand and cand.get("qbo_write"))),
                "why": cand["why"] if cand else "New task: not classified yet",
                "detail": ladder.get("detail"),
                "history": [],
                "cols": COLS,
                "files": self.files_for(t["key"], reg),
                "note": reg.get("notes", {}).get(t["key"]),
            })
        tasks.sort(key=lambda t: (
            DUE_ORDER.index(t["due"]) if t["due"] in DUE_ORDER else 99,
            0 if t["order"] is not None else 1,
            t["order"] or 0,
            t["row"],
        ))
        removed = [{
            "key": k,
            "task": e["task"],
            "due": e["due"],
            "assigned": e.get("assigned"),
            "last_row": e.get("last_row"),
            "removed_at": e["removed_at"],
            "history": [],
        } for k, e in reg["tasks"].items() if e.get("removed_at")]
        luke = [t for t in tasks if t["assigned"] == "Luke"]
        return {
            "tasks": tasks,
            "removed": removed,
            "last_synced": reg.get("last_synced"),
            "snapshot_read": reg.get("snapshot_read") or SNAPSHOT_READ,
            "changes": changes or {"added": [], "removed": [], "restored": []},
            "luke_count": len(luke),
            "ready_count": sum(t["ladder"] == "ready" for t in luke),
            "source": "Shared Accounting > Month End- 2026 (read-only snapshot)",
        }

    def load_and_sync(self):
        reg, sheet, changes = self.sync()
        return self.build(reg, sheet, changes)

    def save_snapshot(self, csv_text, stamp=None):
        stamp = stamp or now().strftime("%Y-%m-%d_%H%M%S")
        text = csv_text if csv_text.endswith("\n") else csv_text + "\n"
        if "Task" not in text.splitlines()[0]:
            raise ValueError("snapshot needs a header row with a Task column")
        snap = self.data_dir / "sheet_snapshots" / f"month_end_2026_{stamp}.csv"
        snap.write_text(text, encoding="utf-8")
        self.sheet.write_text(text, encoding="utf-8")

        def mark():
            reg = self._read_reg()
            reg["snapshot_read"] = now().isoformat(timespec="seconds")
            self._write_reg(reg)

        self._locked(mark)
        return self.load_and_sync()

    def add_file_req(self, k, item):
        def run():
            reg = self._read_reg()
            if k not in reg["tasks"]:
                raise KeyError(k)
            types = [
                t.strip().lower() if t.strip().startswith(".") else "." + t.strip().lower()
                for t in str(item.get("types", "")).replace("/", ",").split(",") if t.strip()
            ]
            clean = {
                "name": str(item.get("name", "")).strip()[:200],
                "hint": str(item.get("hint", "")).strip()[:500],
                "types": types,
                "required": bool(item.get("required")),
                "last_used": None,
                "added_by_luke": now().isoformat(timespec="seconds"),
            }
            if not clean["name"]:
                raise ValueError("name required")
            reg.setdefault("file_reqs", {}).setdefault(k, []).append(clean)
            self._write_reg(reg)
            return clean

        return self._locked(run)

    def save_note(self, k, text, file_name=None):
        def run():
            reg = self._read_reg()
            if k not in reg["tasks"]:
                raise KeyError(k)
            val = {"text": str(text or "").strip()[:4000], "edited_at": now().isoformat(timespec="seconds")}
            if file_name is None:
                bucket = reg.setdefault("notes", {})
                slot = k
            else:
                bucket = reg.setdefault("file_notes", {}).setdefault(k, {})
                slot = str(file_name)
            if val["text"]:
                bucket[slot] = val
            else:
                bucket.pop(slot, None)
            self._write_reg(reg)
            return val

        return self._locked(run)

    def task_by_key(self, k, payload=None):
        data = payload or self.load_and_sync()
        return next((t for t in data["tasks"] if t["key"] == k), None)


def history_items(task_key, requests):
    items = []
    for h in HISTORY.get(task_key, []):
        items.append({
            "when": f"Oct 10 {h['time']}",
            "state": h["state"],
            "result": h["result"],
            "files": ", ".join(h.get("files") or []),
            "run_note": "",
            "standing": "",
        })
    for rec in requests:
        files = rec.get("files") or []
        bits = []
        for f in files:
            bit = f.get("name") or "file"
            if f.get("file_note"):
                bit += f" (file note: {f['file_note']})"
            bits.append(bit)
        items.append({
            "when": fmt_ts(rec["created_at"]),
            "state": rec["status"],
            "result": rec.get("result") or "",
            "files": ", ".join(bits),
            "run_note": rec.get("run_note") or "",
            "standing": rec.get("standing_note") or "",
        })
    return items


_OPEN = {"queued": "queued", "awaiting_approval": "awaiting", "approved": "approved"}


def public_request(rec):
    return {
        "rid": rec["id"],
        "state": _OPEN.get(rec["status"], rec["status"]),
        "result": rec.get("result") or "",
        "month": rec.get("log_month"),
        "qbo": rec.get("qbo"),
        "run_note": rec.get("run_note") or "",
    }


def decorate(payload, requests):
    """Fold persisted Run Now requests into the checklist the page renders."""
    by_key = {}
    for rec in requests:
        by_key.setdefault(rec["task_key"], []).append(rec)
    for task in payload["tasks"]:
        recs = by_key.get(task["key"], [])
        task["history"] = history_items(task["key"], recs)
        task["requests"] = [public_request(r) for r in recs]
        task["open_request"] = next(
            (p for p in reversed(task["requests"]) if p["state"] in ("queued", "awaiting", "approved")),
            None,
        )
        for rec in recs:
            if rec["status"] != "succeeded":
                continue
            month = rec.get("log_month") or (month_name(rec["done_date"]) if rec.get("done_date") else None)
            text = rec.get("done_text") or (done_text(rec["done_date"]) if rec.get("done_date") else "Done")
            if month in task["months"]:
                task["months"][month] = {"kind": "done", "text": text}
    for task in payload["removed"]:
        task["history"] = history_items(task["key"], by_key.get(task["key"], []))
    return payload
