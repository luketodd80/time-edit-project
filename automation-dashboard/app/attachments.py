"""PNG, JPEG, and PDF attachments for one month of a month-end task.

Files live under DATA_DIR/attachments. The registry keeps the caption and the
relative path. Files are served only to a logged-in session.
"""
import os
import re
import uuid
from pathlib import Path

from app.clock import now

MAX_BYTES = 10 * 1024 * 1024
_MONTH = re.compile(r"^(\d{4})-(\d{2})$")
_FILE = re.compile(r"^attachments/[a-f0-9]{32}\.(png|jpg|pdf)$")
_KIND = "file must be a PNG, JPEG, or PDF"
_ID = re.compile(r"^[a-f0-9]{32}$")


def parse_month(raw):
    match = _MONTH.match(str(raw or "").strip())
    if not match:
        raise ValueError("month must look like 2026-10")
    year, month = int(match.group(1)), int(match.group(2))
    if not (2000 <= year <= 2100) or not (1 <= month <= 12):
        raise ValueError("month must look like 2026-10")
    return f"{year:04d}-{month:02d}"


def sniff_image(raw):
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if raw.startswith(b"%PDF-"):
        return "application/pdf", "pdf"
    return None, None


def _declared_type(content_type, filename):
    ctype = (content_type or "").split(";")[0].strip().lower()
    ext = Path(filename or "").suffix.lower()
    if ctype in ("image/png",):
        return "png"
    if ctype in ("image/jpeg", "image/jpg"):
        return "jpg"
    if ctype == "application/pdf":
        return "pdf"
    if ctype in ("", "application/octet-stream"):
        if ext == ".png":
            return "png"
        if ext in (".jpg", ".jpeg"):
            return "jpg"
        if ext == ".pdf":
            return "pdf"
        return ""
    raise ValueError(_KIND)


def read_image(storage):
    """Return bytes, content type, extension, and a display name. Raise ValueError."""
    if storage is None or not getattr(storage, "filename", None):
        raise ValueError("file is required")
    raw = storage.read()
    if not isinstance(raw, (bytes, bytearray)):
        raise ValueError("file is required")
    raw = bytes(raw)
    if not raw:
        raise ValueError("file is empty")
    if len(raw) > MAX_BYTES:
        raise ValueError("file is over 10 MB")
    sniffed, ext = sniff_image(raw)
    if not sniffed:
        raise ValueError(_KIND)
    try:
        declared = _declared_type(getattr(storage, "content_type", "") or getattr(storage, "mimetype", ""), storage.filename)
    except ValueError:
        raise
    if declared and declared != ext:
        raise ValueError(_KIND)
    fallback = "file." + ext
    name = os.path.basename(str(storage.filename or fallback))
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name)[:80] or fallback
    return raw, sniffed, ext, name


def _caption(raw):
    return " ".join(str(raw or "").split())[:300]


def public_attachment(item):
    return {
        "id": item.get("id"),
        "caption": item.get("caption") or "",
        "content_type": item.get("content_type") or "",
        "size": item.get("size") or 0,
        "name": item.get("name") or "",
        "created_at": item.get("created_at") or "",
        "url": "/api/monthend/attachments/" + str(item.get("id") or ""),
    }


def public_attachments(reg, task_key):
    raw = ((reg.get("attachments") or {}).get(task_key) or {})
    out = {}
    if not isinstance(raw, dict):
        return out
    for month, items in raw.items():
        if not isinstance(items, list):
            continue
        pub = [public_attachment(it) for it in items if isinstance(it, dict) and _ID.match(str(it.get("id") or ""))]
        if pub:
            out[str(month)] = pub
    return out


def _find(reg, att_id):
    bucket = reg.get("attachments") or {}
    if not isinstance(bucket, dict):
        return None, None, None
    for task_key, months in bucket.items():
        if not isinstance(months, dict):
            continue
        for month, items in months.items():
            if not isinstance(items, list):
                continue
            for item in items:
                if isinstance(item, dict) and item.get("id") == att_id:
                    return task_key, month, item
    return None, None, None


def _safe_path(data_dir, rel):
    if not _FILE.match(str(rel or "")):
        raise KeyError(rel)
    root = (Path(data_dir) / "attachments").resolve()
    path = (Path(data_dir) / rel).resolve()
    if root != path.parent:
        raise KeyError(rel)
    return path


def add_attachment(me, task_key, month, raw, content_type, ext, name, caption):
    att_id = uuid.uuid4().hex
    rel = f"attachments/{att_id}.{ext}"
    path = _safe_path(me.data_dir, rel)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)

    def run():
        reg = me._read_reg()
        if task_key not in reg.get("tasks", {}):
            raise KeyError(task_key)
        item = {
            "id": att_id,
            "file": rel,
            "content_type": content_type,
            "size": len(raw),
            "name": name,
            "caption": _caption(caption),
            "created_at": now().isoformat(timespec="seconds"),
        }
        reg.setdefault("attachments", {}).setdefault(task_key, {}).setdefault(month, []).append(item)
        me._write_reg(reg)
        return public_attachment(item)

    try:
        return me._locked(run)
    except Exception:
        path.unlink(missing_ok=True)
        raise


def list_attachments(me, task_key, month):
    def run():
        reg = me._read_reg()
        if task_key not in reg.get("tasks", {}):
            raise KeyError(task_key)
        items = ((reg.get("attachments") or {}).get(task_key) or {}).get(month) or []
        return [public_attachment(it) for it in items if isinstance(it, dict)]

    return me._locked(run)


def delete_attachment(me, att_id):
    if not _ID.match(str(att_id or "")):
        raise KeyError(att_id)

    def run():
        reg = me._read_reg()
        task_key, month, item = _find(reg, att_id)
        if not item:
            raise KeyError(att_id)
        items = reg["attachments"][task_key][month]
        reg["attachments"][task_key][month] = [it for it in items if it.get("id") != att_id]
        if not reg["attachments"][task_key][month]:
            reg["attachments"][task_key].pop(month, None)
        if not reg["attachments"][task_key]:
            reg["attachments"].pop(task_key, None)
        me._write_reg(reg)
        return item

    item = me._locked(run)
    try:
        _safe_path(me.data_dir, item.get("file")).unlink(missing_ok=True)
    except KeyError:
        pass
    return item


def open_attachment(me, att_id):
    if not _ID.match(str(att_id or "")):
        raise KeyError(att_id)

    def run():
        reg = me._read_reg()
        _task, _month, item = _find(reg, att_id)
        if not item:
            raise KeyError(att_id)
        path = _safe_path(me.data_dir, item.get("file"))
        if not path.is_file():
            raise KeyError(att_id)
        return path, item.get("content_type") or "application/octet-stream", item.get("name") or "image"

    return me._locked(run)
