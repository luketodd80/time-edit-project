"""SQLite store under DATA_DIR. Notes for month-end also live in the registry JSON."""
import json
import sqlite3
import threading
from pathlib import Path

from app.clock import now


def _iso(dt=None):
    return (dt or now()).isoformat(timespec="seconds")


class DB:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA busy_timeout=5000")
        self._init()

    def _init(self):
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS automation_overrides (
              id TEXT PRIMARY KEY,
              status TEXT NOT NULL,
              next_run TEXT,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS command_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              at TEXT NOT NULL,
              automation_id TEXT,
              name TEXT,
              action TEXT,
              result TEXT
            );
            CREATE TABLE IF NOT EXISTS runs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              automation_id TEXT NOT NULL,
              bot TEXT,
              ts TEXT NOT NULL,
              day TEXT NOT NULL,
              status TEXT NOT NULL,
              summary TEXT,
              slot TEXT,
              source TEXT,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS runs_day ON runs(day);
            CREATE INDEX IF NOT EXISTS runs_auto ON runs(automation_id, ts);
            CREATE TABLE IF NOT EXISTS run_requests (
              id TEXT PRIMARY KEY,
              task_key TEXT NOT NULL,
              task_name TEXT,
              row_num INTEGER,
              bot TEXT,
              qbo INTEGER NOT NULL DEFAULT 0,
              log_month TEXT,
              run_note TEXT,
              standing_note TEXT,
              files_json TEXT,
              status TEXT NOT NULL,
              result TEXT,
              done_date TEXT,
              done_text TEXT,
              completion_notes TEXT,
              day TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              approved_at TEXT,
              completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS run_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              at TEXT NOT NULL,
              request_id TEXT,
              name TEXT,
              step TEXT,
              detail TEXT
            );
            """
        )

    def overrides(self):
        with self._lock:
            rows = self.conn.execute("SELECT * FROM automation_overrides").fetchall()
        return {r["id"]: {"status": r["status"], "next_run": r["next_run"]} for r in rows}

    def set_status(self, automation_id, status, next_run):
        with self._lock:
            self.conn.execute(
                """
                INSERT INTO automation_overrides (id, status, next_run, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET status=excluded.status, next_run=excluded.next_run, updated_at=excluded.updated_at
                """,
                (automation_id, status, next_run, _iso()),
            )

    def add_command(self, automation_id, name, action, result):
        at = now().strftime("%b %d, %-I:%M %p ET")
        with self._lock:
            self.conn.execute(
                "INSERT INTO command_log (at, automation_id, name, action, result) VALUES (?, ?, ?, ?, ?)",
                (at, automation_id, name, action, result),
            )
        return {"at": at, "id": automation_id, "name": name, "action": action, "result": result}

    def command_log(self, limit=200):
        with self._lock:
            rows = self.conn.execute(
                "SELECT at, automation_id, name, action, result FROM command_log ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {"at": r["at"], "id": r["automation_id"], "name": r["name"], "action": r["action"], "result": r["result"]}
            for r in rows
        ]

    def add_run(self, automation_id, bot, ts, day, status, summary, slot, source="ingest"):
        created = _iso()
        with self._lock:
            cur = self.conn.execute(
                """
                INSERT INTO runs (automation_id, bot, ts, day, status, summary, slot, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (automation_id, bot, ts, day, status, summary, slot, source, created),
            )
            rid = cur.lastrowid
        return self.get_run(rid)

    def get_run(self, rid):
        with self._lock:
            row = self.conn.execute("SELECT * FROM runs WHERE id=?", (rid,)).fetchone()
        return dict(row) if row else None

    def runs_on(self, day):
        with self._lock:
            rows = self.conn.execute("SELECT * FROM runs WHERE day=? ORDER BY ts, id", (day,)).fetchall()
        return [dict(r) for r in rows]

    def latest_run(self, automation_id):
        with self._lock:
            row = self.conn.execute(
                "SELECT * FROM runs WHERE automation_id=? ORDER BY ts DESC, id DESC LIMIT 1",
                (automation_id,),
            ).fetchone()
        return dict(row) if row else None

    def add_request(self, rec):
        files = json.dumps(rec.get("files") or [])
        with self._lock:
            self.conn.execute(
                """
                INSERT INTO run_requests (
                  id, task_key, task_name, row_num, bot, qbo, log_month, run_note, standing_note,
                  files_json, status, result, done_date, done_text, completion_notes, day,
                  created_at, updated_at, approved_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rec["id"], rec["task_key"], rec.get("task_name"), rec.get("row_num"), rec.get("bot"),
                    1 if rec.get("qbo") else 0, rec.get("log_month"), rec.get("run_note") or "",
                    rec.get("standing_note") or "", files, rec["status"], rec.get("result") or "",
                    rec.get("done_date"), rec.get("done_text"), rec.get("completion_notes"),
                    rec["day"], rec["created_at"], rec["updated_at"], rec.get("approved_at"), rec.get("completed_at"),
                ),
            )
        return self.get_request(rec["id"])

    def get_request(self, rid):
        with self._lock:
            row = self.conn.execute("SELECT * FROM run_requests WHERE id=?", (rid,)).fetchone()
        return self._request(row) if row else None

    def _request(self, row):
        if not row:
            return None
        d = dict(row)
        d["files"] = json.loads(d.pop("files_json") or "[]")
        d["qbo"] = bool(d["qbo"])
        return d

    def all_requests(self):
        with self._lock:
            rows = self.conn.execute("SELECT * FROM run_requests ORDER BY created_at, id").fetchall()
        return [self._request(r) for r in rows]

    def open_request_for(self, task_key):
        open_states = ("queued", "awaiting_approval", "approved")
        for rec in reversed(self.all_requests()):
            if rec["task_key"] == task_key and rec["status"] in open_states:
                return rec
        return None

    def update_request(self, rid, **fields):
        allowed = {
            "status", "result", "done_date", "done_text", "completion_notes",
            "approved_at", "completed_at",
        }
        sets = {k: v for k, v in fields.items() if k in allowed}
        sets["updated_at"] = _iso()
        cols = list(sets)
        sql = "UPDATE run_requests SET " + ", ".join(f"{c}=?" for c in cols) + " WHERE id=?"
        with self._lock:
            self.conn.execute(sql, [sets[c] for c in cols] + [rid])
        return self.get_request(rid)

    def add_run_log(self, request_id, name, step, detail):
        at = now().strftime("%b %d, %-I:%M %p ET")
        with self._lock:
            self.conn.execute(
                "INSERT INTO run_log (at, request_id, name, step, detail) VALUES (?, ?, ?, ?, ?)",
                (at, request_id, name, step, detail),
            )

    def run_log(self, limit=200):
        with self._lock:
            rows = self.conn.execute(
                "SELECT at, request_id, name, step, detail FROM run_log ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {"at": r["at"], "request_id": r["request_id"], "name": r["name"], "step": r["step"], "detail": r["detail"]}
            for r in rows
        ]
