# Grok automation dashboard

Daily runs, the automation catalog, and Luke's month-end checklist for The Service Company. This is its own web app in `automation-dashboard/`. The time-edit app at the repo root is a separate Render service and is not part of this process.

Three tabs, same ones Luke approved:

1. **Today / Daily runs.** Every scheduled bot run for the day. A 7-day strip, Today / Yesterday, and previous / next arrows move through history. Group by Time or by Bot. A row stays **no report yet** until its scheduled time passes, then **missed**, unless a bot has posted a result.
2. **All automations.** The 30 automations across 13 bots. Pause, resume, and retire are saved here. They are not sent to the bots.
3. **On demand / Month-end.** Every line assigned to Luke on Shared Accounting → Month End- 2026. Tasks are keyed by task name + due, not by row number, and each one also has a permanent id (`ME-001`, `ME-002`, …) assigned once in the registry and never reused. The id stays put when the row number changes. A line that shows up on a new snapshot gets the automation badge New until you change it. The badges are Manual, Run Now- Ready, and New. Luke can switch any line among those three on the row, and a bot can set the same badge with the machine API. That choice is stored under `DATA_DIR` and kept when a new sheet snapshot arrives. A former candidate bot is not labeled. A line that disappears goes to Removed from sheet. A rename or a move to another week looks like a removed line plus a new line; Luke or a bot can link the new line to the old id so it keeps that id, its notes, files, status, and badge. Run Now queues a request while the badge is Run Now- Ready. It does not write the Google Sheet or QuickBooks.

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
| `SYNC_WEBHOOK_URL` | no | Fallback URL for **Sync now** when Settings has no URL saved |
| `SYNC_WEBHOOK_KEY` | no | Fallback key sent with that request when Settings has no key saved |
| `PORT` | set by Render | The start command binds to it |

`render.yaml` in this folder is a reference for that service. Do not move it to the repo root.

## Persistence

Everything that has to survive a restart lives under `DATA_DIR`:

- `dashboard.sqlite` — recorded runs, Run Now requests, pause/resume/retire, command log
- `month_end_2026.csv` — latest sheet snapshot
- `month_end_registry.json` — task identity, the permanent id (`ME-001`, …), standing notes, per-file notes, added file requirements, manual month status (Done / In progress / Skipped / Not started), the automation badge on each task (Manual / Run Now- Ready / New), which week groups are collapsed, which new lines have had the link suggestion dismissed, the captions for history images, and the sheet write-back queue
- `uploads/` — files attached to Run Now
- `attachments/` — PNG and JPEG images on a task's month history (10 MB each)
- `sheet_snapshots/` — each snapshot a bot posts
- `settings.json` — Sync webhook URL and key (mode `0600`). The API returns the URL and a masked key, never the full key
- `vehicle_lease.json` and `vehicle_lease/` — fleet registry, ignored units, journal settings, and each month's JE CSV, fleet-report PDF, and detail CSV

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

A new task-name + due key starts as New. A badge already stored on a key is kept. Missing keys move to Removed from sheet. Notes already stored on a key are kept. Response: `{"ok": true, "changes": {"added": [], "removed": [], "restored": []}, "tasks": 0, "removed": 0}`.

This dashboard does not read Google Sheets. **Sync now** (Settings, behind login) asks an outside automation to read the sheet and call this endpoint.

### Sync now

`POST /api/monthend/sync` (session cookie, not the ingest token) reads the webhook from Settings, then from `SYNC_WEBHOOK_URL` / `SYNC_WEBHOOK_KEY` if a field was left empty. It POSTs:

```json
{"source": "automation-dashboard", "action": "month-end-sync", "requested_at": "2026-10-10T16:00:00-04:00"}
```

When a key is set, the same value is sent as `Authorization: Bearer <key>`, `X-Webhook-Key: <key>`, and `X-Api-Key: <key>`. The Month-End tab then says the sync was requested and checks `last_synced` about every 10 seconds for up to 3 minutes. When a new snapshot lands, the list refreshes and the added and removed task names are shown. If no webhook is configured, the response is `400` with `"error": "no_webhook"`. If the receiver returns an error, the status code is shown.

`GET /api/settings` and `POST /api/settings` read and save `sync_webhook_url` and `sync_webhook_key`. A blank key on save keeps the key already stored. The key is not returned in full.

### Mark a month-end task done

`POST /api/ingest/month-end/status`

This does not write the Google Sheet. It stores the checklist status under `DATA_DIR`. Match the task by name and due (case and extra spaces do not matter). `month` defaults to the current month in Eastern Time. `date` defaults to today in Eastern Time when status is `done`.

```bash
curl -s -X POST "$BASE/api/ingest/month-end/status" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task":"Payroll Report","due":"2nd Week","month":"October","status":"done","date":"2026-10-11","note":"Ran it outside the bot"}'
```

`status` is `done`, `in_progress`, `skipped` (`n/a` is the same), `not_started`, or `auto`. `auto` clears a status set through this API or the dashboard and lets the sheet decide again. A date in that month's sheet column (January is column G, October is column P) already shows Done, with that date, without this call. A successful Run Now completion also shows Done for the month it was logged under.

Send `id` instead of `task` and `due` when you already know the permanent id: `{"id":"ME-014","month":"October","status":"done"}`. `ME-14` is the same id as `ME-014`.

The signed-in dashboard has the same action at `POST /api/monthend/completion` (`key`, `month`, `status`, `date`, `note`). Week groups on the Month-End tab remember collapsed or expanded with `POST /api/monthend/weeks` (`due`, `collapsed`). A week with no saved choice starts collapsed when every task in it is Done for the month on screen. **Hide Finished Tasks**, at the top of that tab, hides every line that is Done for the month on screen. A week with nothing left stays as a collapsed header with a count such as `3 done hidden`. The choice is kept in this browser.

### Set a month-end automation badge

`POST /api/ingest/month-end/automation`

This does not write the Google Sheet. It stores `Manual`, `Run Now- Ready`, or `New` on the task under `DATA_DIR`. Match the task by name and due, the same way as status. A later sheet snapshot does not clear it. Run Now is available while the badge is Run Now- Ready.

```bash
curl -s -X POST "$BASE/api/ingest/month-end/automation" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task":"Run SalesPeople Commissions","due":"1st week","automation":"Run Now- Ready"}'
```

`automation` (or `badge`) is one of those three strings. `ready` and `run now ready` mean Run Now- Ready. An unknown task is `404`. A value outside those three is `400`.

The signed-in dashboard uses `POST /api/monthend/automation` with `key` (or `task` and `due`) and `automation`. Each row on the Month-End tab has the same control. This endpoint also accepts `id` (`ME-014`) in place of the task name and due.

### List month-end tasks

`GET /api/ingest/month-end/tasks`

Returns every line on the current snapshot, plus `removed` for lines that have left the sheet. `month` is the current month in Eastern Time, and `status` is that month's checklist status (`not_started`, `in_progress`, `done`, or `skipped`). `notes` is the standing note saved on the dashboard. `badge` is Manual, Run Now- Ready, or New.

```bash
curl -s "$BASE/api/ingest/month-end/tasks" \
  -H "Authorization: Bearer $INGEST_TOKEN"
```

```json
{"ok": true, "month": "October", "tasks": [{"id": "ME-001", "task": "Prep COT & Send to Sheldon", "due": "1st week", "badge": "Manual", "status": "done", "notes": ""}], "removed": []}
```

### Link a renamed line to its old id

A task name or due change on the sheet shows up here as a new line and a line under Removed from sheet. Linking gives the new line the old permanent id and moves the standing notes, file requirements, file notes, checklist status, and automation badge onto it. The old line leaves Removed from sheet. The temporary id the new line had is never used again.

`POST /api/ingest/month-end/link`

```bash
curl -s -X POST "$BASE/api/ingest/month-end/link" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"ME-048","link_to":"ME-014"}'
```

`link_to` is the id still on the removed line. The new line can be named with `id`, or with `task` and `due`. An unknown id is `404`. Linking an id that is still on the sheet, or linking a line that was already here when tracking started, is `400`.

On the Month-End tab, a new line shows **Link to a removed task** while something is in Removed from sheet. **Dismiss** hides that suggestion for this line. It stays hidden, under `DATA_DIR`, until the line's task name or due text changes. A smaller **Link to removed task…** action stays on the row so Luke can still link a rename or a move on purpose. The id on each row is click-to-copy. The signed-in routes are `POST /api/monthend/link` (`key`, `link_to`) and `POST /api/monthend/link/dismiss` (`key` or `id`).

`POST /api/ingest/month-end/link/dismiss`

```bash
curl -s -X POST "$BASE/api/ingest/month-end/link/dismiss" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"ME-048"}'
```

`id` is the new line. `task` and `due` work the same way as the other month-end calls. An unknown id is `404`. The dismissal is cleared on the next snapshot whose task name or due for that line is different.

### Attach an image to a month's history

`POST /api/ingest/month-end/attachment`

Sends one PNG or JPEG for a task and a month (`2026-10`). A task-month can hold several images. Each file is at most 10 MB. The bytes have to be a PNG or JPEG. The image is stored under `DATA_DIR` and shows as a thumbnail in that month's history entry on the Month-End tab. Click the thumbnail to open it full size. **Delete** on the thumbnail removes that image. The image URL works for a logged-in session only.

```bash
curl -s -X POST "$BASE/api/ingest/month-end/attachment" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -F "id=ME-029" \
  -F "month=2026-10" \
  -F "caption=October close" \
  -F "file=@close.png;type=image/png"
```

`caption` is optional. An unknown id is `404`. A bad month, an empty file, a file over 10 MB, or a file that is not a PNG or JPEG is `400`.

`GET /api/ingest/month-end/attachments?id=ME-029&month=2026-10` lists the images for that task and month (`id`, `caption`, `content_type`, `size`, `name`, `created_at`). It does not return the file bytes.

### Write a manual Done back to the sheet

The dashboard has no Google credentials and does not write the sheet. When someone marks a task **Done** for a month with the This month control (the Done button, or Change then Done), that queues a write-back under `DATA_DIR` and POSTs the same sync webhook as Sync now, so the routine that already has Sheets access can run promptly. If no webhook is set, or the call fails, the Done mark still saves and the item stays pending. Marking the same month Done again while that item is pending updates its date. Not started, In progress, Skipped, or Use the sheet cancels a pending item. A status set by the machine API, or by a finished Run Now, does not queue a write-back.

`GET /api/ingest/month-end/writebacks?status=pending`

```bash
curl -s "$BASE/api/ingest/month-end/writebacks?status=pending" \
  -H "Authorization: Bearer $INGEST_TOKEN"
```

Each item has `writeback_id`, `id` (such as `ME-014`), `task` (column D), `due`, `month` (`2026-10`), `done_date` (`10/11`), `created_at`, `status`, and `row`. `row` is that task's row on the latest snapshot. If the line has left the sheet, it is the last row number that snapshot stored. Omit `status` to list pending items. `status` can also be `written`, `skipped`, `flagged`, `cancelled`, or `all`.

`POST /api/ingest/month-end/writebacks/<writeback_id>/result`

```bash
curl -s -X POST "$BASE/api/ingest/month-end/writebacks/WRITEBACK_ID/result" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"flagged","note":"row was empty"}'
```

`status` is `written`, `skipped`, or `flagged`. `note` is optional. An unknown id is `404`. A cancelled item, or any other status, is `400`. Flagged and skipped show on that task for the month: `Couldn't write to sheet: <note>`. Written does not.

### Vehicle lease (ME task)

The Month-End tab links to `/vehicle-lease`, and so does the vehicle-lease line (and `ME-030`). The page keeps the fleet registry, the ignored-unit list, and the journal settings under `DATA_DIR`. The first run seeds 13 vehicles from `seed/fleet_registry.csv` and 71 ignored units from `seed/ignored_units.txt`.

The monthly charge is the standard loan payment on starting value, term, and rate. A vehicle is active from its start month through the term. **All Locations** splits that payment by Covington 22 / Greenville 18 / Dayton 16 / Springfield 15 / Columbus 17 / Mobile 12. Those percents are editable and must total 100. The GL account `611-3 Vehicle Lease Expense (Internal)` is used on every debit and on the credit. The credit location is Truck Sales. Default rate is 7% and the default term is 60 months.

Generate a month on the page (or `POST /api/vehicle-lease/runs` with `{"month":"2026-09"}`). That stores one history entry: the JE CSV, the Fleet Manager Report PDF, the detail CSV, branch totals, a fleet-check result, and a QBO JE # Don can fill in later. September 2026 on the seeded fleet is **$6,910.61** across 13 active units. The JE columns match `JournalNo,JournalDate,Account,Debits,Credits,Description,Name,Location`, with journal number `VEH-LEASE-SEP2026` and date `09/30/2026`.

`GET /api/ingest/vehicle-lease/registry` and `GET /api/ingest/vehicle-lease/ignored` return the fleet and the ignored list.

`POST /api/ingest/vehicle-lease/runs` stores a month the bot already computed. Send multipart fields `month`, `je`, `pdf`, and `detail`, plus either a `payload` JSON string or the fields `total`, `active_units`, `branches`, `fleet_check`, `fleet_status` (`ok`, `flagged`, or `skipped`), and `qbo_je`.

```bash
curl -s -X POST "$BASE/api/ingest/vehicle-lease/runs" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -F "month=2026-09" \
  -F 'payload={"total":6910.61,"active_units":13,"branches":{"Covington":196.03},"fleet_check":"13 active units","fleet_status":"ok","qbo_je":""}' \
  -F "je=@veh_lease_JE_SEP2026.csv;type=text/csv" \
  -F "pdf=@Fleet-Report-September-2026.pdf;type=application/pdf" \
  -F "detail=@Fleet-Report-September-2026.csv;type=text/csv"
```

`PATCH /api/ingest/vehicle-lease/runs/2026-09` with `{"qbo_je":"1577201"}` sets the QuickBooks journal number after Don posts it. The signed-in page has the same field. An unknown month is `404`.

## Adding a tab

`app/modules.py` lists the tabs. To add the time-edit app (or anything else) as another module:

1. Append `{id, label, endpoint}` in `app/modules.py`.
2. Add a `<div class="wrap hidden" id="{id}View">` in `templates/index.html` and a branch in `showTab`.
3. Register its routes next to the ones in `app/web.py`.

Login, `DATA_DIR`, and the tab bar stay shared. Give the new module its own tables.
