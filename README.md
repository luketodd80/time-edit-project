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

## What is loaded

The demo clock is Tuesday, October 6, 2026. A Tuesday review covers the previous day, so Monday, October 5 starts selected. Friday, October 2 stays on the 14-day trail.

Friday, October 2, 2026 is the curated Dayton shop report: Nick Sontag, Brayden Mapp, and Colby Purvis are already at goal with no gaps. Zach Spencer, Cole Lozan, and Tanveer Dhaliwal have the findings from that report. Saturday, October 3 is in the day list with no findings yet.

Monday, October 5, 2026 comes from a Fullbay Office timesheet scrape (`data/fullbay-timesheets/timesheets-2026-10-05.json`, status All, all shops, all employees). Each shop in that file becomes a day report: Dayton, Covington, Greenville, Springfield, Mobile, and Columbus. Clocked hours are the punch rows. Service-order hours are the segments whose complaint names an SO. Shop foremen Thomas Flora, James Benedict, Isaac Stockslager, and Kevin Neal are omitted, as is anyone with no service-order time that day. Suggested edits are a nearest-order heuristic from those punches, not a manager note. The scrape does not say whether an order is invoiced, so Monday orders are marked open on priorities. Open punches keep the elapsed hours already on the row and say that end is not a clock-out. Nothing here writes back to Fullbay.

The shop filter is All shops plus every shop that has a loaded day.

## How a review works

1. Filter by shop and check the days to review. The recent range, Sundays excluded, is the audit trail. Due days that are still open are not approved. Older days that were never signed off are marked skipped.
2. On Review, each technician who needs a decision is one table of the segments loaded for that day, in clock order. Yellow rows are missed time. The orange row is billable work with no service order. Off-the-clock rows say they are not a gap. Accept or reject a recommendation in one click. Reject does not ask for a reason. Override shows a start and an end, prefilled with the recommendation. Change either field, or both. Clear a field, or leave it as recommended, and that side stays recommended. Techs already at or above 98% sit in a short no-change table.
3. Submit records the decisions in this browser and opens Confirm: edits that would be written, rejects with no reason, and orders skipped because they are invoiced or closed. Nothing is sent to Fullbay.
4. Summary recomputes utilization for the same shop and days. Accepted and overridden minutes are added to SO hours. Rejected items add none.
5. Check off that you approve that day's utilization numbers, then mark the day done. The day cannot be marked done without the check. Done days stay on the trail. Uncheck to reopen a day.

Decisions, the shop and day selection, and sign-off stay in `localStorage` under `tsc-time-gap-review-v2`. There is no login and no network call.
