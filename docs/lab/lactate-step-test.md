# Lactate step test
- **Entry**: table of steps (power W, heart rate, lactate mmol/L, optional RPE, step length).
- **Calculation** (`src/lib/lactateStepTest.js`): LT1 (baseline + 0.5 / log-log break), LT2 via Dmax (max distance from line through first and last points of a polynomial fit), OBLA 2 and 4 mmol by interpolation. Each returns power and HR.
- **Chart**: lactate curve with threshold markers (reuse chart components).
- **Persistence**: `lab_lactate_tests` + steps jsonb; save feeds existing lactate threshold history and zones (`lactateThresholds.js`). Private: athlete and coach only.
- **Tests**: unit tests on known curves; harness for scoping.

## Implementation (as built)
- Migration `20270159000000_lab_lactate.sql`: table `lab_lactate_tests` (no client privileges), RPCs `lab_lactate_save` (validates 3-20 steps, power/lactate/HR ranges, size), `lab_lactate_list`, `lab_lactate_delete`, all gated with `lab_gate` (athlete or `is_coach_of`; module flag as for the protocol runner).
- `src/lib/lactateStepTest.js`: LT1 = baseline (lowest of the first 3 steps) + 0.5 mmol/L, LT2 = Dmax on a cubic fit (needs 4+ steps; falls back to OBLA 4), OBLA 2/4 by linear interpolation; HR interpolated between steps.
- Apply writes LT1/LT2 (power + HR) to the athlete's lactate threshold history on the test date via `saveLtEntry` (confirm when the date already has an entry), so zones follow it.
- UI: `/coach/<id>/lab/lactate` and `/lab/lactate`. Harness: `lab-lactate-adversarial.mjs`; unit tests `lactateStepTest.test.js`.
