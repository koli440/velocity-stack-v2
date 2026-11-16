# Power profile and phenotype
- Input: athlete best power at 5 s, 1 min, 5 min, 20 min (from power curve), weight, age, sex.
- `src/lib/powerProfile.js`: W/kg vs benchmark table by sex and age band, scored per duration (percentile-like 0-100); phenotype = sprinter / pursuiter / time-trialist from the highest relative strengths (with an "all-rounder" threshold).
- UI: radar/bar chart and explanation. Benchmarks and thresholds documented in code. Pure unit tests.

## Implementation (as built)
- No new table or migration: computed client side from the athlete's `activities.curves_data.Power` (best per duration over 90 days or a year; RLS lets the athlete and their active coach read it) and `weight_history`. Age and sex are entered in the view and not stored (no demographic columns exist; avoids new personal data).
- `src/lib/powerProfile.js`: anchors per duration (men, W/kg at scores 0/25/50/75/100), women x0.88, age factor -0.8 %/year over 35 (floor 0.7). Phenotype: sprinter (2x5 s + 1 min), pursuiter (1 min + 5 min), time trialist (5 min + 2x20 min); highest wins, all-rounder if the spread is under 8 points.
- UI `/coach/<id>/lab/profile`, `/lab/profile`; unit tests `powerProfile.test.js`.
