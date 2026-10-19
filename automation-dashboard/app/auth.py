"""Single shared password, signed session cookie, and a bearer token for bots."""
import hmac
from urllib.parse import quote

from flask import current_app, jsonify, redirect, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

COOKIE = "dashboard_session"
MAX_AGE = 14 * 24 * 3600


def serializer():
    return URLSafeTimedSerializer(current_app.config["SESSION_SECRET"], salt="dashboard-session")


def logged_in():
    token = request.cookies.get(COOKIE)
    if not token:
        return False
    try:
        serializer().loads(token, max_age=MAX_AGE)
        return True
    except (BadSignature, SignatureExpired):
        return False


def set_session(resp):
    token = serializer().dumps({"v": 1})
    secure = request.is_secure or request.headers.get("X-Forwarded-Proto", "").lower() == "https"
    resp.set_cookie(
        COOKIE, token, httponly=True, samesite="Lax", secure=secure,
        max_age=MAX_AGE, path="/",
    )
    return resp


def clear_session(resp):
    resp.delete_cookie(COOKIE, path="/")
    return resp


def bearer_ok():
    expected = current_app.config.get("INGEST_TOKEN") or ""
    header = request.headers.get("Authorization", "")
    if not expected or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[7:].strip(), expected)


def password_ok(got):
    expected = current_app.config["DASHBOARD_PASSWORD"]
    if not got or not expected:
        return False
    return hmac.compare_digest(str(got), expected)


def safe_next(raw):
    if not raw or not raw.startswith("/") or raw.startswith("//"):
        return "/"
    return raw


def register(app):
    @app.before_request
    def gate():
        path = request.path
        if path == "/healthz":
            return None
        if path.startswith("/api/ingest/"):
            if bearer_ok():
                return None
            return jsonify(error="unauthorized"), 401
        if path == "/login" and request.method in ("GET", "POST"):
            return None
        if logged_in():
            return None
        if path.startswith("/api/"):
            return jsonify(error="unauthorized"), 401
        nxt = request.full_path if request.query_string else request.path
        return redirect("/login?next=" + quote(nxt, safe="/"))

    @app.after_request
    def no_store(resp):
        if request.path.startswith("/api/") or request.path in ("/", "/login"):
            resp.headers["Cache-Control"] = "no-store"
        return resp
