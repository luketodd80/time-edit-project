"""Optional sample reports from the Oct 2026 mockup.

Used only when DEMO_SEED is on. The live board does not load these, so a day
with no bot report stays "no report yet" or "missed".
"""

UNKNOWN = "Not reported yet; will come from the bot's run log when wired."

def _u(aid, slot=None):
    rec = {"id": aid, "status": "unknown", "summary": UNKNOWN}
    if slot:
        rec["slot"] = slot
    return rec

def _ok(aid, slot, actual, summary="Succeeded"):
    rec = {"id": aid, "status": "ok", "actual": actual, "summary": summary}
    if slot:
        rec["slot"] = slot
    return rec

_TE = [
    "time-edit-state-backup-before-nightly-deploy",
    "nightly-fullbay-clock-ins-time-edit-app",
    "morning-time-edit-ready-operations-managers",
    "time-edit-restore-sign-offs-after-nightly-deploy",
]
_TE_SLOTS = ["02:41", "02:56", "03:47", "04:23"]

DEMO = {
    "2026-10-09": [
        *[_u(a, s) for a, s in zip(_TE, _TE_SLOTS)],
        _ok("daily-fullbay-inventory-po-dashboard", "04:05", "4:09 AM", "10-9-26 tab: 71 vendors, $98,077.96"),
        _ok("po-dashboard-4-15-blocker-check", "04:15", "4:20 AM", "On track, no alert needed"),
        _ok("servco-2-0-daily-inventory-download", "04:58", "5:03 AM"),
        _ok("daily-servco-inventory-pull", "04:59", "5:03 AM"),
        _ok("daily-primary-inbox-digest", "06:59", "7:10 AM"),
        _ok("fullbay-parts-request-monitor", None, "Last run 7:59 PM", "Last run succeeded; counts per run not reported"),
        _ok("fullbay-parts-research-accuracy", None, "Last run 7:26 PM", "Last run succeeded"),
        _ok("daily-parts-margin-report", "08:05", "8:23 AM", "Sent to Jared & Jeremy group DM"),
        _ok("linkedin-weekly-post-check", "08:13", "8:33 AM"),
        _ok("remind-change-dext-subscription", "08:27", "8:52 AM", "Reminder sent to Luke"),
        _u("fullbay-po-session-keep-alive", "12:37"),
        _ok("fullbay-po-session-keep-alive", "17:37", "5:40 PM", "Healthy, on Covington"),
        _ok("weekday-parts-research-daily-summary", "17:22", "5:27 PM", "Nothing sent: no research saved that day"),
        _u("primary-inbox-triage"),
        _u("time-edit-submit-chris-applies-in-fullbay"),
    ],
    "2026-10-10": [
        _ok(a, s, act) for a, s, act in zip(_TE, _TE_SLOTS, ["2:50 AM", "3:05 AM", "3:49 AM", "4:30 AM"])
    ] + [
        _ok("primary-inbox-triage", None, "Last run 9:51 AM", "Last run succeeded"),
        _u("time-edit-submit-chris-applies-in-fullbay"),
        _u("fullbay-parts-alert-instant"),
    ],
}

EXTRAS = {
    "2026-10-10": [
        {
            "key": "me-run-row13", "id": "me-run-row13", "bot": "Grok Bot",
            "name": "Month-end Row 13: Update Perform Shared Resources Spreadsheet",
            "time": "On demand", "sort": 9999, "freq": "Kicked off by Luke", "kind": "webhook",
            "ran": "yes", "outcome": "ok", "actual": "~3:50 PM",
            "result": "Succeeded. Copied Template to 'September 2026' and filled B6:G34 from the Bamboo payroll export; sheet shows 10/10 in P13.",
            "flag": None, "trigger": "Run Now from the On demand / Month-end tab", "delivers_to": "Luke",
            "does": "Grok Bot / Month-End: Bamboo payroll export -> Shared Resources spreadsheet.",
        },
        {
            "key": "me-run-row14", "id": "me-run-row14", "bot": "Don",
            "name": "Month-end Row 14: Create JE for Shared Resources",
            "time": "On demand", "sort": 9999, "freq": "Kicked off by Luke", "kind": "webhook",
            "ran": "yes", "outcome": "ok", "actual": "~3:55 PM",
            "result": "Succeeded. Don posted QBO JE 1577158 'PR-SEP-2026-SR' (9/30/2026, $50,111.96) with Luke's approval; sheet shows 10/10 in P14.",
            "flag": None, "trigger": "Run Now from the On demand / Month-end tab", "delivers_to": "Luke",
            "does": "Don prepares the Shared Resources JE; posts to QBO only after Luke approves.",
        },
    ],
}


def lookup(day, automation_id, slot):
    found = []
    for rec in DEMO.get(day, []):
        if rec["id"] != automation_id:
            continue
        if slot is None:
            if rec.get("slot") is None:
                found.append(rec)
        elif rec.get("slot") == slot:
            found.append(rec)
    return found


def extras(day):
    return [dict(r) for r in EXTRAS.get(day, [])]
