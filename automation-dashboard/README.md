# Grok automation dashboard

Daily runs, the automation catalog, and Luke's month-end checklist for The Service Company. This is its own web app in `automation-dashboard/`. The time-edit app at the repo root is a separate Render service and is not part of this process.

Three tabs, same ones Luke approved:

1. **Today / Daily runs.** Every scheduled bot run for the day. A 7-day strip, Today / Yesterday, and previous / next arrows move through history. Group by Time or by Bot. A row stays **no report yet** until its scheduled time passes, then **missed**, unless a bot has posted a result.
2. **All automations.** The 30 automations across 13 bots. Pause, resume, and retire are saved here. They are not sent to the bots.
3. **On demand / Month-end.** Every line assigned to Luke on Shared Accounting → Month End- 2026. Tasks are keyed by task name + due, not by row number. A line that shows up on a new snapshot arrives as Manual with a New tag. A line that disappears goes to Removed from sheet. Run Now queues a request. It does not write the Google Sheet or QuickBooks.

The time-edit app can become another tab later. See [Adding a tab](#adding-a-tab).

## Run locally

From this directory:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
DASHBOARD_PASSWORD=x SESSION_SECRET=y INGEST_TOKEN=z DATA_DIR=/tmp/d \
  PORT=8090 .venv/bin/gunicorn --bind 0.0.0.0:$PORT --workers 2 --timeout 120 --access-logfile - wsgi:app
```

Open http://127.0.0.1:8090 and sign in with the password (`x` in the example). `DATA_DIR` is created on first boot and seeded from `seed/` (the month-end sheet snapshot, the task registry, and the candidate notes). Sample daily runs are not loaded unless you set `DEMO_SEED=1`.

```bash
.venv/bin/python tests/smoke.py
.venv/bin/python tests/smoke.py --live
```

## Render

Create a **new** web service. Leave the existing time-edit service as it is.

| Setting | Value |
| --- | --- |
| Root directory | `automation-dashboard` |
| Build command | `pip install -r requirements.txt` |
| Start command | `gunicorn --bind 0.0.0.0:$PORT --workers 2 --timeout 120 --access-logfile - wsgi:app` |
| Health check path | `/healthz` |

`/healthz` is the only unauthenticated path. It returns `{"ok": true}`.

Attach a persistent disk mounted at `/var/data` (a 1 GB disk is enough) and set the environment:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DASHBOARD_PASSWORD` | yes | Shared password for the login page and the session APIs |
| `SESSION_SECRET` | yes | Signs the session cookie |
| `INGEST_TOKEN` | yes | Bearer token for the machine API below |
| `DATA_DIR` | yes | Set to `/var/data` so notes, uploads, run history, and month-end state survive deploys |
| `DEMO_SEED` | no | Set to `1` only to load the Oct 9–10 sample run reports. Leave unset in production |
| `PORT` | set by Render | The start command binds to it |

`render.yaml` in this folder is a reference for that service. Do not move it to the repo root.

## Persistence

Everything that has to survive a restart lives under `DATA_DIR`:

- `dashboard.sqlite` — recorded runs, Run Now requests, pause/resume/retire, command log
- `month_end_2026.csv` — latest sheet snapshot
- `month_end_registry.json` — task identity, standing notes, per-file notes, added file requirements
- `uploads/` — files attached to Run Now
- `sheet_snapshots/` — each snapshot a bot posts

The browser does not store notes, files, or run history.

## Machine API

Bots authenticate with `Authorization: Bearer $INGEST_TOKEN`. The session cookie is not accepted on these paths. None of them write to Google Sheets or QuickBooks.

### Record a daily run

`POST /api/ingest/runs`

```bash
curl -s -X POST "$BASE/api/ingest/runs" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bot": "Time Edit Project",
    "automation_id": "time-edit-state-backup-before-nightly-deploy",
    "timestamp": "2026-10-10T02:50:00-04:00",
    "status": "ok",
    "summary": "Snapshot saved"
  }'
```

`automation_id` is the id from the catalog (All automations). `status` is `ok`, `issue`, `failed`, or `missed`. `timestamp` is ISO 8601; a trailing `Z` is accepted, and a value with no offset is read as Eastern. Optional `slot` (`"4:05 AM"` or `"04:05"`) picks which clock time a two-a-day job belongs to; otherwise the closest scheduled time is used.

The run shows on the daily board for that Eastern calendar date.

### List pending Run Now requests

`GET /api/ingest/run-requests`

Returns requests in `queued`, `awaiting_approval`, or `approved`. Each item includes the task, the log-under month, standing notes, the note for this run, whether it is a QuickBooks write, and the attached files.

`GET /api/ingest/run-requests/<id>` returns one request.

`GET /api/ingest/run-requests/<id>/files/<file_id>` downloads one attached file. Use the `download_path` from the request payload. Send the same bearer token.

### Finish a Run Now request

`POST /api/ingest/run-requests/<id>/complete`

```bash
curl -s -X POST "$BASE/api/ingest/run-requests/$ID/complete" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"succeeded","notes":"Filled B6:G34","done_date":"2026-10-10"}'
```

`status` is `succeeded`, `failed`, or `awaiting_approval`. `notes` is stored on the run. `done_date` is `YYYY-MM-DD`. The cell text is that date (`10/10`). The column is the month Luke chose with **Log under** when he clicked Run Now (it defaults to the month the run was queued). For a QuickBooks task, a `succeeded` post is held as **Awaiting your approval** until Luke approves in the dashboard. Poll `GET /api/ingest/run-requests` until `status` is `approved`, then post `succeeded` again. A rejection is `failed` and drops off the pending list. Nothing is posted to QuickBooks from this app.

### Push a month-end snapshot

`POST /api/ingest/month-end`

Send the sheet as CSV (`Content-Type: text/csv`, same columns as Month End- 2026, header required) or JSON:

```json
{"csv": "Due,Order,Category,Task,...\n"}
```

or

```json
{"rows": [{"Due": "1st week", "Order": "", "Category": "Test", "Task": "New line", "Notes/ Questions": "", "Assigned To": "Luke", "January": "", "February": "", "March": "", "April": "", "May": "", "June": "", "July": "", "August": "", "September": "", "October": "", "November": "", "December": ""}]}
```

The snapshot goes through the same sync as the in-app Sync button. New task-name + due keys are Manual and tagged New. Missing keys move to Removed from sheet. Notes already stored on a key are kept. Response: `{"ok": true, "changes": {"added": [], "removed": [], "restored": []}, "tasks": 0, "removed": 0}`.

## Adding a tab

`app/modules.py` lists the tabs. To add the time-edit app (or anything else) as another module:

1. Append `{id, label, endpoint}` in `app/modules.py`.
2. Add a `<div class="wrap hidden" id="{id}View">` in `templates/index.html` and a branch in `showTab`.
3. Register its routes next to the ones in `app/web.py`.

Login, `DATA_DIR`, and the tab bar stay shared. Give the new module its own tables.
