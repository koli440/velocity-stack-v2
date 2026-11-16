# Lactate step test
- **Entry**: table of steps (power W, heart rate, lactate mmol/L, optional RPE, step length).
- **Calculation** (`src/lib/lactateStepTest.js`): LT1 (baseline + 0.5 / log-log break), LT2 via Dmax (max distance from line through first and last points of a polynomial fit), OBLA 2 and 4 mmol by interpolation. Each returns power and HR.
- **Chart**: lactate curve with threshold markers (reuse chart components).
- **Persistence**: `lab_lactate_tests` + steps jsonb; save feeds existing lactate threshold history and zones (`lactateThresholds.js`). Private: athlete and coach only.
- **Tests**: unit tests on known curves; harness for scoping.
