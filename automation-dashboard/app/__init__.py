"""Grok automation dashboard. Create the Flask app with create_app()."""
import logging
import os
from pathlib import Path

from flask import Flask

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "seed"


def _flag(value):
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def create_app(overrides=None):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 48 * 1024 * 1024
    app.config["DATA_DIR"] = os.environ.get("DATA_DIR", "")
    app.config["DASHBOARD_PASSWORD"] = os.environ.get("DASHBOARD_PASSWORD", "")
    app.config["SESSION_SECRET"] = os.environ.get("SESSION_SECRET", "")
    app.config["INGEST_TOKEN"] = os.environ.get("INGEST_TOKEN", "")
    app.config["DEMO_SEED"] = _flag(os.environ.get("DEMO_SEED", ""))
    if overrides:
        app.config.update(overrides)
        if "DEMO_SEED" in overrides:
            app.config["DEMO_SEED"] = _flag(overrides["DEMO_SEED"])

    missing = [name for name in ("DATA_DIR", "DASHBOARD_PASSWORD", "SESSION_SECRET", "INGEST_TOKEN") if not app.config.get(name)]
    if missing:
        raise RuntimeError("Missing required config: " + ", ".join(missing))

    data = Path(app.config["DATA_DIR"]).expanduser().resolve()
    data.mkdir(parents=True, exist_ok=True)
    app.config["DATA_DIR"] = str(data)
    app.config["DATA_DIR_PATH"] = data

    from app.auth import register as register_auth
    from app.db import DB
    from app.ingest import register as register_ingest
    from app.month_end import MonthEnd
    from app.web import register as register_web

    app.extensions["db"] = DB(data / "dashboard.sqlite")
    app.extensions["month_end"] = MonthEnd(data, SEED)
    register_auth(app)
    register_web(app)
    register_ingest(app)
    app.logger.info("dashboard data directory %s", data)
    return app
