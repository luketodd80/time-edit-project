"""Automation catalog plus the schedule used to draw the daily board.

autos.py is the list Luke confirmed (30 automations, 13 bots). Schedule rules
live here so a day with no bot report still shows each expected run.
"""
from app.autos import AUTOS

ALL_BOTS = [
    "Grok Bot", "Ed", "2.0", "Don", "Flo", "CEO", "Nathan",
    "Purchase Order Dashboard Project", "Time Edit Project", "Chris",
    "Warranty", "Recruiter", "Amber", "Grok-Yoda",
]

# kind:
#   daily / weekdays — point times, "HH:MM" 24-hour
#   dow — weekdays listed Monday=0 … Sunday=6
#   month_days — calendar days of each month
#   window — one row covering start–end (hourly / every-5-min jobs)
#   webhook — on demand, never "missed" just because nobody clicked
#   none — one-time or retired, not on the board
ANNOTATIONS = {
    "monthly-fullbay-receipt-pdf-to-sheldon": {
        "kind": "month_days", "days": [5, 6, 7, 8, 9], "times": ["09:32"],
        "active_from": "2026-11-05",
        "board_note": "Monthly Fullbay receipt PDF next runs Nov 5",
    },
    "weekday-parts-research-daily-summary": {"kind": "weekdays", "times": ["17:22"]},
    "daily-servco-inventory-pull": {"kind": "weekdays", "times": ["04:59"]},
    "daily-parts-margin-report": {"kind": "weekdays", "times": ["08:05"]},
    "new-qbo-vendors-slack-angie": {
        "kind": "weekdays", "times": ["06:12"],
        "active_from": "2026-10-12",
        "before_note": "New QBO vendors → Slack Angie was created that evening; first run Mon Oct 12",
    },
    "primary-inbox-triage": {
        "kind": "window", "start": "00:15", "end": "23:45", "weekdays": False,
        "label": "Hourly at :15 and :45, all day", "display": "All day", "sort": 15,
    },
    "daily-primary-inbox-digest": {"kind": "weekdays", "times": ["06:59"]},
    "remind-change-dext-subscription": {"kind": "weekdays", "times": ["08:27"]},
    "linkedin-weekly-drafts": {"kind": "dow", "days": [0], "times": ["07:58"]},
    "linkedin-weekly-post-check": {"kind": "dow", "days": [4], "times": ["08:13"]},
    "daily-fullbay-inventory-po-dashboard": {"kind": "weekdays", "times": ["04:05"]},
    "po-dashboard-4-15-blocker-check": {"kind": "weekdays", "times": ["04:15"]},
    "fullbay-po-session-keep-alive": {
        "kind": "weekdays", "times": ["12:37", "17:37"],
        "keys": ["keepalive-1237", "keepalive-537"],
    },
    "time-edit-state-backup-before-nightly-deploy": {"kind": "daily", "times": ["02:41"]},
    "nightly-fullbay-clock-ins-time-edit-app": {"kind": "daily", "times": ["02:56"]},
    "morning-time-edit-ready-operations-managers": {"kind": "daily", "times": ["03:47"]},
    "time-edit-restore-sign-offs-after-nightly-deploy": {"kind": "daily", "times": ["04:23"]},
    "time-edit-submit-chris-applies-in-fullbay": {"kind": "webhook"},
    "fullbay-parts-request-monitor": {
        "kind": "window", "start": "07:01", "end": "19:56", "weekdays": True,
        "label": "Every 5 min, 7:01 AM–7:56 PM", "anchor": "07:01",
    },
    "fullbay-parts-research-accuracy": {
        "kind": "window", "start": "07:24", "end": "19:24", "weekdays": True,
        "label": "Hourly, 7:24 AM–7:24 PM", "anchor": "07:24",
    },
    "servco-2-0-daily-inventory-download": {"kind": "weekdays", "times": ["04:58"]},
    "fullbay-parts-alert-instant": {"kind": "webhook"},
    "daily-fullbay-inventory-po-dashboard-chris": {"kind": "weekdays", "times": ["04:05"]},
    "fullbay-session-keep-alive-chris": {
        "kind": "weekdays", "times": ["12:37", "17:37"],
        "keys": ["keepalive-chris-1237", "keepalive-chris-537"],
    },
}

_SCHEDULE_KEYS = {
    "kind", "days", "times", "keys", "start", "end", "label", "display", "sort", "anchor", "weekdays",
}
_PUBLIC = (
    "id", "name", "owner", "category", "does", "trigger", "trigger_type",
    "delivers_to", "last_run", "next_run", "status", "created", "source", "flag",
)


def annotated():
    """Catalog rows with schedule metadata. Status here is the catalog default."""
    out = []
    for raw in AUTOS:
        item = dict(raw)
        ann = ANNOTATIONS.get(raw["id"], {})
        sched = {k: v for k, v in ann.items() if k in _SCHEDULE_KEYS}
        item["schedule"] = sched or {"kind": "none"}
        for k in ("active_from", "board_note", "before_note"):
            if k in ann:
                item[k] = ann[k]
        item["_catalog_next"] = raw.get("next_run")
        out.append(item)
    return out


def by_id():
    return {a["id"]: a for a in annotated()}


def public_view(item):
    out = {}
    for k in _PUBLIC:
        if k in item and item[k] is not None:
            out[k] = item[k]
        elif k in ("last_run", "next_run"):
            out[k] = item.get(k)
    if "flag" not in item:
        out.pop("flag", None)
    return out


def apply_override(item, override):
    """Pause / resume / retire stick in the database and win over the catalog."""
    merged = dict(item)
    merged["_catalog_next"] = item.get("next_run")
    if not override:
        return merged
    merged["status"] = override["status"]
    merged["next_run"] = override.get("next_run")
    return merged
