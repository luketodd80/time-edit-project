"""Sync webhook settings. Saved values live in DATA_DIR; env vars are the fallback."""
import fcntl
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from flask import current_app


def _path():
    return Path(current_app.config["DATA_DIR_PATH"]) / "settings.json"


def _read_saved():
    path = _path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_saved(data):
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_suffix(".lock")
    tmp = path.with_suffix(".json.tmp")
    with open(lock_path, "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
            os.chmod(path, 0o600)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def mask_key(key):
    key = key or ""
    if not key:
        return ""
    if len(key) <= 4:
        return "••••"
    return "••••" + key[-4:]


def valid_webhook_url(url):
    parsed = urlparse(url or "")
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def resolve_webhook():
    """Saved Settings win. Empty saved fields fall back to the environment."""
    saved = _read_saved()
    saved_url = str(saved.get("sync_webhook_url") or "").strip()
    saved_key = str(saved.get("sync_webhook_key") or "")
    env_url = str(current_app.config.get("SYNC_WEBHOOK_URL") or "").strip()
    env_key = str(current_app.config.get("SYNC_WEBHOOK_KEY") or "")
    if saved_url:
        url, url_source = saved_url, "saved"
    elif env_url:
        url, url_source = env_url, "env"
    else:
        url, url_source = "", "none"
    if saved_key:
        key, key_source = saved_key, "saved"
    elif env_key:
        key, key_source = env_key, "env"
    else:
        key, key_source = "", "none"
    return {
        "url": url,
        "key": key,
        "url_source": url_source,
        "key_source": key_source,
    }


def public_settings():
    cfg = resolve_webhook()
    return {
        "sync_webhook_url": cfg["url"],
        "sync_webhook_key_set": bool(cfg["key"]),
        "sync_webhook_key_mask": mask_key(cfg["key"]),
        "url_source": cfg["url_source"],
        "key_source": cfg["key_source"],
    }


def save_settings(url, key=None, update_key=False):
    url = str(url or "").strip()
    if url and not valid_webhook_url(url):
        raise ValueError("webhook URL must start with http:// or https://")
    saved = _read_saved()
    saved["sync_webhook_url"] = url[:2000]
    if update_key:
        saved["sync_webhook_key"] = str(key or "")[:500]
    _write_saved(saved)
    return public_settings()
