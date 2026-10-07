# Time gap review

A local review screen for The Service Company service managers. It shows one shop day of technician time-gap findings, lets a manager accept, reject, or override each recommended clock time, and records what would be edited. Utilization is recomputed from the minutes that would be added to service-order hours. The goal is 98%.

Fullbay login, Fullbay report pull, and Fullbay time-edit writes are intentionally not built yet. The Dayton PDF report is a separate deliverable and is not generated here.

## Run

```bash
npm install
npm run dev -- --port 4317
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317).

```bash
npm test
npm run lint
```

## Shared password

Managers need a username and password before the dashboard or the API loads.

On Render, open the service **Environment** and set:

| Variable | Role |
| --- | --- |
| `SITE_USER` | Shared username. Optional. Defaults to `servco` when unset or blank. |
| `SITE_PASSWORD` | Shared password. This turns the gate on. |

Then redeploy.

When `SITE_PASSWORD` is unset or empty, the gate is off. Local `npm run dev` stays open, and a Render service without that variable stays open too.

When `SITE_PASSWORD` is set, HTTP Basic auth covers every path: pages, `/api` (including the pending edit queue), and static files. The browser shows its login dialog. The password lives only in the host environment. It is not stored in this repo.

`FULLBAY_EDIT_QUEUE_TOKEN` is separate. When that token is set, queue POST and confirm still require the header `x-fullbay-edit-token`.

## What is loaded

The review date is the current calendar day in America/New_York, so the due day moves on its own. A weekday review is due for the previous day. Monday is due for Friday and Saturday. The day chips and audit trail are the previous 14 days, no earlier than Friday, October 2, and Sundays stay off. One day is selected at a time. A signed-off day says Done with the time it was approved, and choosing it opens that day's Summary.

Tuesday, Monday, Friday, and Saturday are the Details List downloads `timesheets-download-2026-10-06.csv`, `timesheets-download-2026-10-05.csv`, `timesheets-download-2026-10-02.csv`, and `timesheets-download-2026-10-03.csv` in `data/fullbay-timesheets`. Tuesday is status All, 399 rows, date October 6 only. Monday is status All, 343 rows, pulled at 3:00 AM ET on October 6. The earlier on-screen scrapes are not loaded. Those downloads have a Clock In Comment column the on-screen scrape left blank. Clocked hours are the punch rows (`Type` Clocked, or a scrape row with no service order), not the service-order rows nested inside them, so the timesheet footer is not the shop's clocked total. Service-order hours are the segments whose complaint names an SO. Each service order stays on the shop in its prefix: D Dayton, M Mobile, S Springfield, C Covington, G Greenville, CL Columbus. A tech with service-order punches at more than one shop is listed on each of those shops. A shop’s review shows that shop’s own service-order rows. Punches on any shop’s service orders count as covered when gaps are built, so a foreign-shop punch is not off the clock and is not a gap. It can appear in the timeline labeled with its shop. It is not editable and does not add to the viewing shop’s clocked or service-order hours. Shop foremen Thomas Flora, James Benedict, Isaac Stockslager, and Kevin Neal are omitted, as is anyone with no service-order time that day. A no-SO punch is aimed at the nearest service order for that tech. When Clock In Comment names a coworker (“Help Nick”, and similar wording) and that person has an overlapping service order on the same shop day, the edit is aimed at their order. From October 6 on, a gap that ends when the next punch is Non-Pro or attendance extends the earlier service order’s clock-out up to that Non-Pro start, and does not move a clock-in onto the Non-Pro row. Off-the-clock stretches, and Non-Pro notes that say “Waiting on job” or “Waiting on work”, are not suggested as billable service-order time. The timesheet does not say whether an order is invoiced, so orders are marked open on priorities. Open punches keep the elapsed hours already on the row and say that end is not a clock-out. Inactive 24-hour placeholders stay in the download, such as Josh Silva-holley and Travis Hess from 12:00 AM October 6 to 12:00 AM October 7, and are left out of review. Nothing here writes back to Fullbay.

The shop filter is All shops plus every shop that has a loaded day.

## How a review works

1. Filter by shop and choose one day. Due, open, and signed-off days look different. The audit trail starts Friday, October 2, and Sundays are left out. Status is Approved only when every shop in view is marked done; otherwise it is Not approved. Original utilization is that day's service-order hours divided by clocked hours, for the shops in view. Corrected utilization adds accepted and overridden minutes, the same way Summary does. A day with no clocked hours shows a dash.
2. On Review, each technician who needs a decision is one table of the segments loaded for that day, in clock order. Yellow rows are missed time. The orange row is billable work with no service order. Off-the-clock rows say they are not a gap. Accept or reject a recommendation in one click. Reject does not ask for a reason. Override shows a start and an end, prefilled with the recommendation. Change either field, or both. Clear a field, or leave it as recommended, and that side stays recommended. Techs already at or above 98% sit in a short no-change table. A signed-off or already submitted shop and day cannot be accepted, rejected, or overridden.
3. Submit records the decisions in this browser and opens Confirm only after the apply queue accepts the batch. The server refuses a shop and day that is already signed off or already submitted. Rejected edits are not queued. Confirm shows each edit as pending, applied, or failed. Chris applies the clock times in Fullbay, then confirms the batch. This app does not log into Fullbay.
4. Summary recomputes utilization for the same shop and day. Accepted and overridden minutes are added to SO hours. Rejected items add none. A technician's name opens that day's service-order punches after those edits, including another shop's punches as labeled context.
5. Check off that you approve that day's utilization numbers, then mark the day done. The day cannot be marked done without that check, or while the latest queued edits for that shop and day are still pending or failed. Rejected edits do not block sign-off. Done days stay on the trail and stay locked.

Decisions and the shop and day selection stay in `localStorage` under `tsc-time-gap-review-v2`. Sign-off is also recorded on the server in `data/shop-day-signoffs.json`. The apply queue is `data/fullbay-edit-queue.json` on the server.

### Apply queue

`POST /api/fullbay-edits` stores a batch and returns 409 when any shop and day in it is already signed off or already submitted. The server assigns `id`. `POST /api/signoffs` records `{ day, shopId }` and keeps the first sign-off time. Each edit has `findingId`, `day`, `shopId`, `shopName`, `techName`, `orderId`, `work`, `decision` (`accept` or `override`), `newClockIn`, `newClockOut`, `minutes`, `status` (`pending`, `applied`, or `failed`), `appliedAt`, and `applyNote`.

`GET /api/fullbay-edits/pending` lists batches that still have a pending edit. `GET /api/fullbay-edits/latest` returns the newest batch and the full queue. `POST /api/fullbay-edits/confirm` takes `{ batchId, results: [{ findingId, status, applyNote? }] }` and updates those edits. If `FULLBAY_EDIT_QUEUE_TOKEN` is set, POST and confirm require the header `x-fullbay-edit-token`.

### Submit webhook

After the queue write succeeds, and the batch has at least one accepted or overridden edit, the server POSTs a JSON notice. That notice is how an assistant can wake up and hand the batch to Chris. Leave `SUBMIT_WEBHOOK_URL` unset and nothing is sent. A timeout or a failed call is logged and does not fail Submit.

Set these on the Render service Environment, then redeploy:

| Variable | Role |
| --- | --- |
| `SUBMIT_WEBHOOK_URL` | Where to POST. Unset or empty skips the webhook. |
| `SUBMIT_WEBHOOK_KEY` | Optional sender key. |
| `SUBMIT_WEBHOOK_KEY_HEADER` | Optional header name for that key. |

When the key is set and `SUBMIT_WEBHOOK_KEY_HEADER` is unset, the request sends `Authorization: Bearer <key>`. When the header name is set, the request sends that header with the key as the raw value.

The body is `{ "event": "time-edit.submitted", "batchId", "shopId", "shopName", "days", "submittedAt", "editCount", "techs", "dashboardUrl" }`. `editCount` is the number of accepted and overridden edits in the batch. `techs` is the unique technician names. `dashboardUrl` is `https://time-edit-project.onrender.com/`. The body does not include passwords. A batch that is only rejections is not sent. The call times out after about 5 seconds.
