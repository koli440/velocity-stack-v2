# Power profile and phenotype
- Input: athlete best power at 5 s, 1 min, 5 min, 20 min (from power curve), weight, age, sex.
- `src/lib/powerProfile.js`: W/kg vs benchmark table by sex and age band, scored per duration (percentile-like 0-100); phenotype = sprinter / pursuiter / time-trialist from the highest relative strengths (with an "all-rounder" threshold).
- UI: radar/bar chart and explanation. Benchmarks and thresholds documented in code. Pure unit tests.
