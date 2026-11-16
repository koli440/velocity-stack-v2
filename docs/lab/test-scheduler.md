# Test scheduler
- Repeating blocks: protocol, interval (weeks, e.g. 8), start date, end date, owner coach/athlete.
- Table `lab_test_schedules`; pg_cron job (SQL only) creates `lab_test_runs` and notifications `lab_test_due` (new idempotent CHECK update) 3 days before and on the day.
- Timeline: per-athlete list of past/planned runs with result deltas (FTP change), visible to coach and athlete.
- Tests: next-date calculation unit tests; harness for scoping and idempotent cron function.

## Implementation (as built)
- Migration `20270160000000_lab_scheduler.sql`: `lab_test_schedules`, `lab_schedule_reminders` (no client privileges), RPCs `lab_schedule_save`, `lab_schedules_list` (with next due date), `lab_schedule_stop`, all behind `lab_gate`; `lab_schedule_next` computes start + k * interval.
- `lab_schedule_tick()` (pg_cron `lab-schedule-tick`, daily 06:05 UTC, SQL only, not callable by clients) sends `lab_test_due` to the athlete 3 days ahead and on the day; `lab_schedule_reminders` makes it idempotent.
- Decision: the cron job does not create runs itself, because the structured workout is built client side; the reminder links to the protocol runner where the coach plans the test in one click. Cron stays free of external secrets.
- Timeline (`labSchedule.js` `buildTimeline`) lists runs oldest first with FTP deltas. UI `/coach/<id>/lab/schedule`, `/lab/schedule`. Harness `lab-scheduler-adversarial.mjs`, unit `labSchedule.test.js`.
