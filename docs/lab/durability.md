# Durability test
- Protocol: 5-min max effort fresh, ride ~2000 kJ at endurance intensity, repeat 5-min effort.
- Detection: from the activity, first 5-min best vs best 5-min after cumulative work reaches 2000 kJ. Result: fresh W, fatigued W, % drop.
- Stored as a `lab_test_runs` result; trend over time. Tests: unit tests on synthetic streams.

## Implementation (as built)
- No new table: results are computed client side from the athlete's recent rides (`activities.time_series` watts, read through RLS: athlete or active coach), so there is nothing to store and the trend is just the list of qualifying rides (last 6 months, newest first). Decision: not stored in `lab_test_runs`, whose protocol list is fixed to the field tests.
- `src/lib/durability.js`: fresh = best 5 min before cumulative work reaches 2000 kJ, fatigued = best 5 min after it; drop % and a rating (<3 excellent, <6 good, <10 fair).
- UI `/coach/<id>/lab/durability`, `/lab/durability`; unit tests `durability.test.js`.
