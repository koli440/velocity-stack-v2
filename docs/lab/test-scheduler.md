# Test scheduler
- Repeating blocks: protocol, interval (weeks, e.g. 8), start date, end date, owner coach/athlete.
- Table `lab_test_schedules`; pg_cron job (SQL only) creates `lab_test_runs` and notifications `lab_test_due` (new idempotent CHECK update) 3 days before and on the day.
- Timeline: per-athlete list of past/planned runs with result deltas (FTP change), visible to coach and athlete.
- Tests: next-date calculation unit tests; harness for scoping and idempotent cron function.
