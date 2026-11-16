# Lactate step test
- **Entry**: table of steps (power W, heart rate, lactate mmol/L, optional RPE, step length).
- **Calculation** (`src/lib/lactateStepTest.js`): LT1 (baseline + 0.5 / log-log break), LT2 via Dmax (max distance from line through first and last points of a polynomial fit), OBLA 2 and 4 mmol by interpolation. Each returns power and HR.
- **Chart**: lactate curve with threshold markers (reuse chart components).
- **Persistence**: `lab_lactate_tests` + steps jsonb; save feeds existing lactate threshold history and zones (`lactateThresholds.js`). Private: athlete and coach only.
- **Tests**: unit tests on known curves; harness for scoping.

## Implementation (as built)
- Migration `20270159000000_lab_lactate.sql`: table `lab_lactate_tests` (no client privileges), RPCs `lab_lactate_save` (validates 3-20 steps, power/lactate/HR ranges, size), `lab_lactate_list`, `lab_lactate_delete`, all gated with `lab_gate` (athlete or `is_coach_of`; no flag).
- `src/lib/lactateStepTest.js`: LT1 = baseline (lowest of the first 3 steps) + 0.5 mmol/L, LT2 = Dmax on a cubic fit (needs 4+ steps; falls back to OBLA 4), OBLA 2/4 by linear interpolation; HR interpolated between steps.
- Apply writes LT1/LT2 (power + HR) to the athlete's lactate threshold history on the test date via `saveLtEntry` (confirm when the date already has an entry), so zones follow it.
- UI: `/coach/<id>/lab/lactate` and `/lab/lactate`. Harness: `lab-lactate-adversarial.mjs`; unit tests `lactateStepTest.test.js`.

## Instructions (fixed) and the New step test form

The page shows a "How to do the test" section with a fixed instruction text (`LACTATE_INSTRUCTION` in `src/lib/lactatePlan.js`): read-only for everyone, no editor, not stored. There is exactly one step definition, the **New step test** form: it is prefilled with the default steps (4 min, 50-110 % FTP, shown as watts from the athlete's FTP at today's date; empty powers when FTP is unknown). For that test the coach (or athlete) can change the step powers, add or remove steps (3-20) and set the step length (1-20 min, saved in the result as `step_minutes`). There is no separate stored template: the earlier template editor and `lab_lactate_plans` were removed (migration `20270181000000_lab_lactate_plan_drop.sql` drops the table and `lab_lactate_plan_*` RPCs; earlier migrations `20270177`/`20270180` are unchanged history).
