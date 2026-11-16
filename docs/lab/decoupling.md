# Efficiency and decoupling trend
- `src/lib/decoupling.js`: Pw:HR of first vs second half of steady rides (>=45 min, variability index <1.10, no big gaps); decoupling % = (EF1-EF2)/EF1.
- Trend chart over qualifying rides with 5% reference line; EF trend. Computed client-side from existing activity data; no new table needed.

## Implementation (as built)
- No new table or migration. `src/lib/decoupling.js` qualifies a ride at >= 45 min, power and HR for >= 90 % of the time, no HR gap over 60 s and variability index (30 s normalised power / average) < 1.10; decoupling % = (EF1 - EF2) / EF1 with EF = watts per bpm per half. Rides come from `labRides.js` (only the watts/heartrate streams of the last 6 months through RLS: athlete or active coach).
- UI `/coach/<id>/lab/decoupling`, `/lab/decoupling` with trend chart, 5 % reference line, table. Unit tests `decoupling.test.js`.
