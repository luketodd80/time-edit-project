"""Ask an outside automation to push a fresh month-end sheet snapshot."""
import json
import urllib.error
import urllib.request

from app import clock
from app.settings_store import resolve_webhook, valid_webhook_url


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_month_end_sync():
    """POST the sync request. Returns (ok, status_code, error_code).

    error_code is "no_webhook", "invalid_url", "webhook_failed", or None.
    status_code is the receiver's HTTP status, or None when the call never
    got a response. The webhook key is not included in either value.
    """
    cfg = resolve_webhook()
    url = cfg["url"]
    if not url:
        return False, None, "no_webhook"
    if not valid_webhook_url(url):
        return False, None, "invalid_url"
    payload = json.dumps({
        "source": "automation-dashboard",
        "action": "month-end-sync",
        "requested_at": clock.now().isoformat(timespec="seconds"),
    }).encode()
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    key = cfg["key"]
    if key:
        req.add_header("Authorization", "Bearer " + key)
        req.add_header("X-Webhook-Key", key)
        req.add_header("X-Api-Key", key)
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(req, timeout=20) as res:
            res.read()
            return True, res.status, None
    except urllib.error.HTTPError as exc:
        return False, exc.code, "webhook_failed"
    except urllib.error.URLError:
        return False, None, "webhook_failed"
