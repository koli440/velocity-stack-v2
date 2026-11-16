# Protocol runner
Guided field tests: FTP ramp, 20-minute, 8-minute, CP3/CP12, CP5/CP20.

- **Definitions** (`src/lib/labProtocols.js`): id, name, brief steps (warm-up, effort, cool-down, fuelling, conditions), structured workout steps, detection rule, result formula (20 min: 95% of mean power; 8 min: 90%; ramp: 75% of best 1-min; CP: two-point work/time regression giving CP and W').
- **Table** `lab_test_runs` (id, athlete_id, coach_id, protocol, status planned|completed|reviewed|applied|cancelled, planned_workout_id, activity_id, result jsonb, created_at). RPCs: `lab_run_create` (coach or athlete; pushes a row to planned workouts), `lab_run_detect` (matches uploaded activity within the planned date and extracts best efforts from the power curve), `lab_run_review` (coach confirms/overrides), `lab_run_apply` (calls existing `applyThresholds` logic for FTP/zones, writes ftpHistory).
- **UI**: protocol picker, brief, "Push to calendar", results card with "Apply FTP and zones" one-click for the coach.
- **Tests**: formula unit tests; harness for scoping, status transitions, apply only by coach.

## Implementation (as built)
- Migration `20270158000000_lab_runs.sql`: table `lab_test_runs` (no client privileges), RPCs `lab_run_create`, `lab_runs_list`, `lab_run_submit`, `lab_run_mark_applied`, `lab_run_cancel`, access helpers `lab_can_access` (athlete or `is_coach_of`) and `lab_gate` (module flag of the caller, or, for the athlete's own data, of an active coach). Notification types `lab_test_planned`, `lab_test_due`, `lab_test_result` are added for the whole Lab module here.
- Creating a run plans a workout (`planned_workouts`, structured DSL + manifest, "set by coach" stamp) and notifies the athlete when a coach plans it. Cancelling an unfinished run removes the workout.
- Detection is client side (`src/lib/labProtocols.js`, `labRuns.js`): best windows of the power stream of rides from one day before to two days after the planned day; the strongest candidate is proposed, then stored with `lab_run_submit` (activity must belong to the athlete).
- Apply uses `applyThreshold` (FTP history, "set by coach" and RLS rules); `lab_run_mark_applied` then records what was applied. Zones follow the FTP unless custom zones are set. CP tests propose FTP = CP (the coach can pick another value in physiology).
- Decision: the athlete can use the lab when their active coach has the module flag, so athletes need no flag themselves; own results at `/lab/protocols`.
- Routes: `/coach/<id>/lab[/protocols]` (coach) and `/lab[/protocols]` (athlete). Harness: `lab-runs-adversarial.mjs`.
