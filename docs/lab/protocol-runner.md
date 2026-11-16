# Protocol runner
Guided field tests: FTP ramp, 20-minute, 8-minute, CP3/CP12, CP5/CP20.

- **Definitions** (`src/lib/labProtocols.js`): id, name, brief steps (warm-up, effort, cool-down, fuelling, conditions), structured workout steps, detection rule, result formula (20 min: 95% of mean power; 8 min: 90%; ramp: 75% of best 1-min; CP: two-point work/time regression giving CP and W').
- **Table** `lab_test_runs` (id, athlete_id, coach_id, protocol, status planned|completed|reviewed|applied|cancelled, planned_workout_id, activity_id, result jsonb, created_at). RPCs: `lab_run_create` (coach or athlete; pushes a row to planned workouts), `lab_run_detect` (matches uploaded activity within the planned date and extracts best efforts from the power curve), `lab_run_review` (coach confirms/overrides), `lab_run_apply` (calls existing `applyThresholds` logic for FTP/zones, writes ftpHistory).
- **UI**: protocol picker, brief, "Push to calendar", results card with "Apply FTP and zones" one-click for the coach.
- **Tests**: formula unit tests; harness for scoping, status transitions, apply only by coach.
