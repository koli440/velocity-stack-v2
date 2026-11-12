# Activity Graph range stats

`ActivityStreamsChart` shows a stats strip (inline panel and enlarged dialog) for the visible range: the zoom range, or "Whole activity" when not zoomed. It updates live on zoom, pan and reset.

Calculations are pure and live in `src/lib/streamStats.js` (`computeStreamStats`, `sampleRange`), tested in `src/lib/__tests__/streamStats.test.js`.

- **Range to samples:** the x-range (seconds or metres) maps to the samples with `lo <= x <= hi`, so time and distance mode give the same stats for the same segment (within the 1 m rounding of the distance axis).
- **Averages:** streams are 1 Hz, so a plain mean over the selected samples is time-weighted; pauses are not stored as samples. Missing samples are skipped, zeros count. Duration is the sample count in seconds; distance integrates speed.
- **NP:** `normalizedPower` from `summaryMetrics.js` (same as the activity summary and templates: 30 s rolling average, 4th power, mean, 4th root; missing power counts as 0). Selections under 30 samples show `-`.
- **VI** = NP / average power; **IF** = NP / `ftp_at_activity_w` (hidden without FTP).
- Metrics the activity has no stream for are hidden.
