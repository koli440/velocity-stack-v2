# Interval DSL — Analysis Template Creator

Velocity Stack's analysis-template system ships four fixed, track-cycling-specific
detection patterns (`repeated_bursts`, `flying_sprint`, `sustained_tt`, `standing_start`).
Alongside those, the **Template Creator** (issue #14) lets any user author a fifth,
generic pattern — `custom_intervals` — by writing a short plain-text description of the
interval structure they want to search for in an activity's power stream. This document
is the reference grammar for that DSL; the same guide is available in-app via the
collapsible "DSL Syntax Guide" section of the Template Creator modal.

The DSL is parsed by `src/lib/intervalDsl.js` (`parseIntervalDsl` / `stringifyIntervalDsl`),
used both server-side (template create/update validation) and client-side (live preview).

## Grammar

```
<N>x
work <value><unit> ±<tolerance>% @ <band>
recovery <value><unit> ±<tolerance>% @ <band>
```

- **Line 1 — repeat count**: `<N>x`, where `N` is an integer `>= 1`. This is the target
  number of times the work(+recovery) cycle should repeat. A manifest with `1x` and a
  single `work` line (no `recovery` line) is a **one-shot pattern**: it searches for a
  single occurrence rather than a repeating sequence — useful for things like a decisive
  climb or a final sprint that only happens once.
- **Step lines**: one `work` line, and optionally one `recovery` line (omit it entirely
  for one-shot patterns).
  - `<role>` — `work` or `recovery`.
  - `<value><unit>` — the target window size. `unit` is either a duration (`min`/`sec`,
    e.g. `3min`, `30sec`) or a **distance** (`km`/`m`, e.g. `4km`, `200m`) — see
    [Distance-keyed steps](#distance-keyed-steps) below.
  - `±<tolerance>%` — a percentage tolerance applied to the target value to get an
    acceptable range. E.g. `3min ±30%` → the detector accepts windows between `126s` and
    `234s`; `4km ±5%` → windows covering between `3.8km` and `4.2km`.
  - `@ <band>` — the power (or speed) band the window must satisfy (see below).

### Power bands

There are six kinds of band:

1. **Relative `%FTP` band** — evaluated against the *activity's own* FTP snapshot
   (`ftp_at_activity_w`), never the athlete's current/live FTP, so matching stays
   consistent even if FTP has drifted a lot since the ride. The snapshot is the entry of
   the athlete's **FTP history** (Settings → FTP) valid on the ride's date; it is set on
   import/sync/upload, and editing the history re-resolves affected activities (including
   Intensity Factor and Training Load).
   - Range: `90-110%FTP`
   - Max only: `<55%FTP`
   - Min only: `>80%FTP`
2. **Absolute watts band** — same range/min/max syntax, suffixed `W` instead of `%FTP`.
   Useful for athletes without an FTP set, or when raw power matters more than a
   relative percentage.
   - Range: `250-300W`
   - Max only: `<150W`
   - Min only: `>280W`
3. **Speed band** — same range/min/max syntax, suffixed `km/h`. Useful for sprint/speed
   work where power isn't the point.
   - Range: `40-50km/h`
   - Max only: `<35km/h`
   - Min only: `>45km/h`
4. **Heart-rate band** (issue #123) — absolute `bpm` or relative `%HRmax`, same
   range/min/max syntax: `150-165bpm`, `<120bpm`, `>170bpm`, `80-90%HRmax`, `<70%HRmax`.
   The window's *average* heart rate must satisfy the band. `%HRmax` is relative to the
   max HR recorded on the activity (`max_hr`), falling back to the highest value in the
   heart-rate stream. Activities without a heart-rate stream report no match (with a
   message) instead of failing.
5. **Cadence band** (issue #123) — `rpm`, same range/min/max syntax: `90-100rpm`,
   `<60rpm`, `>110rpm`. Matched against the average of the cadence stream (coasting
   zeros included).
6. **`best` / `max` keyword** — no numeric threshold at all. Instead of checking against
   a band, the detector locates the single highest-average window of approximately that
   size (duration or distance) in the stream. This is the right choice for structural,
   non-repeatable efforts (a decisive climb, a final sprint, a pursuit pacing block) or
   for comparing the "same" workout years apart without FTP drift getting in the way.
   On a **duration-keyed** step, bare `best`/`max` defaults to optimising average
   **power** (unchanged, for backward compatibility with templates saved before distance
   keying existed). On a **distance-keyed** step the metric must be spelled out
   explicitly, since there's no default: `best power` or `best speed`.

7. **Lactate-threshold band** (issue #121) — relative to the athlete's LT1/LT2, same
   range/min/max syntax: `95-105%LT2`, `<100%LT1`, `>100%LT2` (power) and
   `97-103%LT2HR`, `<100%LT1HR` (average heart rate). Evaluated against the *activity's own*
   LT snapshot (`lt1_power_at_activity_w`, `lt1_hr_at_activity`, `lt2_power_at_activity_w`,
   `lt2_hr_at_activity`, resolved from the effective-dated history at the activity's date),
   never the current values. If the activity has no value for the threshold a step needs
   (or no HR stream for an HR band), the run reports a message instead of failing. LT
   bands are stored as `bandType` `pct_lt1`, `pct_lt2`, `pct_lt1_hr`, `pct_lt2_hr`; efforts
   report `pct_of_lt1`/`pct_of_lt2` (and `avg_hr_bpm` for HR variants). Existing templates
   are unaffected.

8. **Power-to-weight band** (issue #144) — watts per kilogram, same range/min/max syntax:
   `3-3.5W/kg`, `<2W/kg`, `>4W/kg`. A bare target (`work 10min ±10% @ 3W/kg`) means the
   target ±5% and is normalised to an explicit range (`2.85-3.15W/kg`) so text round-trips.
   Evaluated as the effort's average power divided by the *activity's own* weight snapshot
   (`weight_at_activity_kg`, from the effective-dated weight history), never the current weight.
   Without a weight the run reports "No body weight was set for this activity's date" instead
   of failing. Stored as `bandType` `wkg`; matched efforts report `avg_wkg`. Existing templates
   are unaffected.

HR and cadence bands can be freely mixed with power bands across steps of one template
(e.g. `work ... @ 150-165bpm` followed by `recovery ... @ <120bpm`); each step is matched
against its own stream. Efforts matched on an HR band report `avg_hr_bpm`; on a cadence
band, `avg_cadence_rpm`.

### Distance-keyed steps

Instead of a duration unit, a step can use `km` or `m` to search for the best interval
over a target **distance** rather than a target time — e.g. "find my best pace over a
4km Individual Pursuit" or "find my best 200m flying sprint speed", regardless of how
long that distance actually took on the day. Distance is derived by integrating the
activity's per-second speed stream (`velocity_smooth`, where available), so distance-keyed
steps only work on activities that have a speed stream — if one isn't available, the
step reports no match rather than throwing.

```
4x
work 1km ±5% @ best power
recovery 2min ±50% @ <55%FTP

1x
work 200m ±10% @ best speed
```

Duration-keyed and distance-keyed steps can be mixed within the same template (e.g. a
distance-keyed `work` step with a duration-keyed `recovery` step, as above).

### Warm-up and cool-down exclusion

Optional `warmup <n><min|sec>` and `cooldown <n><min|sec>` lines (anywhere after the
repeat line, each at most once; `warm-up`/`cool-down` are accepted too) make the detector
ignore the first / last part of the activity, so a hard warm-up opener or a final sprint
can't be mistaken for a rep. They apply to every step kind (threshold, `best`,
distance-keyed). They are stored in the manifest as `warmup_sec` / `cooldown_sec`
(omitted when unused) and serialised back as `warmup ...` / `cooldown ...` lines directly
after the repeat line.

```
3x
warmup 15min
cooldown 10min
work 10min ±10% @ 90-100%FTP
recovery 5min ±30% @ <55%FTP
```

### Multi-step blocks

A repeat may contain **any number of** `work` and `recovery` lines, matched in the order
written, one after another (each step searched from where the previous one ended):

```
3x
work 2min ±10% @ 95-100%FTP
work 1min ±10% @ 105-110%FTP
recovery 3min ±30% @ <55%FTP
```

For a block with more than one work step (or more than two steps), evaluation additionally
tags every effort with `step_index` (1-based position in the repeat), adds
`summary.step_summaries` (per step: `role`, `count`, `avg_power`), and computes `avg_power`
and `dropoff_pct` per **repeat** (duration-weighted mean of the repeat's work steps)
instead of per step. Plain work(+recovery) templates are evaluated exactly as before.

### Over-unders, pyramids and ramps (contiguous steps)

By default each step is searched from where the previous one ended, but may start later
(that is what lets a recovery be "somewhere after" its work). Prefix a step with `then`
to require it to start **exactly** where the previous step in the same repeat ended.
Chains of contiguous steps with different targets express over-unders, pyramids and ramps:

Over-unders (2min under, 1min over, 2min under, then recover):

```
4x
work 2min ±5% @ 95-100%FTP
then work 1min ±5% @ 105-110%FTP
then work 2min ±5% @ 95-100%FTP
recovery 4min ±30% @ <55%FTP
```

Pyramid:

```
1x
work 1min ±5% @ 100-105%FTP
then work 2min ±5% @ 105-110%FTP
then work 3min ±5% @ 110-115%FTP
then work 2min ±5% @ 105-110%FTP
then work 1min ±5% @ 100-105%FTP
```

Ramp (stepwise ascending targets):

```
1x
work 1min ±5% @ 50-60%FTP
then work 1min ±5% @ 60-70%FTP
then work 1min ±5% @ 70-80%FTP
then work 1min ±5% @ >80%FTP
```

`then` is not allowed on the first step of a repeat. If any step of a repeat cannot be
matched, the whole repeat is dropped (partial repeats are never reported). `then` works
with every band and with duration- and distance-keyed steps. Because windows are matched
by their average within the tolerance, use a small tolerance (`±5%` or less) on contiguous
steps so boundaries line up. A contiguous step is stored as `contiguous: true` on the
step (omitted otherwise), and serialised back as a `then ` prefix.

### Sets

Write `<S> sets of <N>x` on the first line (`set`/`sets`, case-insensitive) to repeat the
block `N` times per set, `S` sets in total. An optional `set recovery` line (same syntax as
a step, but no `then`) is searched for between sets, after the last rep of each set and never
after the last set:

```
3 sets of 5x
work 30sec ±20% @ 120-140%FTP
recovery 30sec ±50% @ <55%FTP
set recovery 5min ±30% @ <55%FTP
```

- Without a `set recovery` line, sets simply follow each other.
- Sets are matched in order: if a set's recovery cannot be found, detection stops
  after that set; an incomplete rep is dropped as usual.
- Efforts get `set` and `rep_in_set` (`rep` stays the overall rep number); the set
  recovery effort has role `set_recovery` and is excluded from work statistics.
- The summary gains `sets_target`, `sets_detected` and `set_summaries`; `reps_target` is
  sets × reps.
- Stored as `set_count` and `set_recovery` on the manifest (omitted when unused), with
  `repeat_count` being the reps per set. `1x`/`Nx` documents are unchanged.
- A `set recovery` line requires a sets line, and may appear at most once.

### Validation rules

- `repeatCount >= 1` (and set count `>= 1` when using `S sets of Nx`).
- Duration (or distance) must be `> 0`.
- Tolerance must be between `0` and `100` (percent).
- At least one `work` step is required.
- `then` may not prefix the first step.
- `warmup`/`cooldown` durations must be `> 0`, use `min`/`sec`, and appear at most once each.
- For `%FTP`/`W`/`km/h`/`bpm`/`%HRmax`/`rpm` bands, bounds must be `>= 0`, and when both a min and max are
  given, `min < max`.
- A distance-keyed step's `best`/`max` band must specify a metric (`best power` or
  `best speed`); a bare `best`/`max` on a distance-keyed step is a validation error.
- Unrecognized band syntax produces a parse error tagged with the offending line number.

### Matching semantics (detection)


- The detector scans the power stream cyclically (work, then recovery if present, then
  back to work) looking for windows that satisfy each step's duration (or distance)
  range and band, up to `repeatCount` times.
- It does **not** require finding the full configured `repeatCount` to produce a result:
  it reports however many complete work(+recovery) cycles were actually found
  (`reps_detected`), alongside the configured target (`reps_target`), so a partial match
  (e.g. "3 of 4 reps") is a valid, useful result rather than a failure.
- For a **distance-keyed** step, the detector instead searches windows whose cumulative
  distance (integrated from the activity's speed stream) falls within the target
  distance's tolerance range, and picks the window with the best `best power`/
  `best speed` metric (or the band match, for `%FTP`/`W`/`km/h` bands) among those.
  Resulting efforts additionally report `target_distance_m`, `distance_m` (distance of the
  matched window), and the exact time for the target distance — see
  [Time and distance results](#time-and-distance-results).

## Worked examples

### 1. Repeated VO2max-style intervals (%FTP-banded)

```
4x
work 3min ±30% @ 90-110%FTP
recovery 2min ±50% @ <55%FTP
```

Looks for up to four work intervals around 3 minutes long (2:06–3:54) averaging
90–110% of the activity's FTP snapshot, each followed by a recovery of around 2 minutes
(1:00–3:00) below 55% FTP.

### 2. Decisive climb / final sprint (one-shot, `best`)

```
1x
work 5min ±40% @ best
```

A single pass, no recovery step: finds the single highest-average-power 5-minute-ish
window (3:00–7:00) in the ride — ideal for locating a defining climb or a decisive
sprint without needing any FTP context.

### 3. Threshold block (%FTP band)

```
1x
work 20min ±15% @ 95-105%FTP
```

A one-shot search for a ~20-minute block (17:00–23:00) at 95–105% of FTP — a classic
threshold/sweet-spot effort.

### 4. Absolute watts (no FTP set)

```
5x
work 30sec ±20% @ 250-300W
recovery 90sec ±50% @ <150W
```

For an athlete without an FTP configured (or where absolute power is simply more
meaningful), this looks for up to five ~30-second efforts at 250–300W, each followed by
~90 seconds of recovery below 150W.

### 5. Individual Pursuit pacing (4 x 1km, best power)

```
4x
work 1km ±5% @ best power
recovery 2min ±50% @ <55%FTP
```

Looks for up to four ~1km (0.95–1.05km) work windows, each scored by its highest average
power, interleaved with ~2 minute recoveries below 55% FTP. Useful for comparing lap
pacing across a 4km Individual Pursuit-style effort — each rep's `avg_power`,
`avg_speed_kmh`, and `estimated_time_sec` are reported individually so splits can be
compared rep-to-rep.

### 6. Flying 200 (one-shot, best speed)

```
1x
work 200m ±10% @ best speed
```

A single pass, no recovery step: finds the single fastest ~200m window (180–220m) by
average speed anywhere in the ride — a flying-200-style effort where speed, not power,
is what matters.

## Summary metrics (`metrics` line)

A `metrics` line (issue #127) lets a template choose extra figures. They are computed
for every work effort (added to the effort as flat fields) and aggregated into the run
summary under the same field name, so they show up in the template run cards, deltas and
comparisons. A template without a `metrics` line produces exactly the same output as before.

```
3x
work 10min ±10% @ 90-100%FTP
recovery 5min ±30% @ <55%FTP
metrics np, vi, hr_recovery(30sec), decoupling, dropoff, pacing
```

- At most one `metrics` line, anywhere after line 1; comma-separated; a trailing `:` after
  `metrics` is accepted. Unknown or duplicate metrics are errors.
- Stored in the manifest as `summary_metrics: [{ "id": "np" }, { "id": "hr_recovery", "window_sec": 30 }]`
  (not `metrics`, which older seeded manifests use as a free-text list).

| Metric | Field | Summary aggregate | Notes |
| --- | --- | --- | --- |
| `avg_power` | `avg_power` | mean | |
| `max_power` | `max_power` | max | |
| `np` | `np_w` | mean | Normalized power (30 s rolling average, 4th-power mean). `null` for efforts shorter than 30 s |
| `vi` | `vi` | mean | Variability index = NP / average power |
| `if` | `intensity_factor` | mean | NP / the activity's FTP snapshot; `null` without FTP |
| `avg_wkg`, `max_wkg`, `np_wkg` | `avg_wkg`, `max_wkg`, `np_wkg` | mean, max, mean | Power divided by the activity's body-weight snapshot (W/kg); `null` without a weight |
| `avg_hr`, `max_hr` | `avg_hr_bpm`, `max_hr_bpm` | mean, max | Needs a heart-rate stream |
| `avg_cadence`, `max_cadence` | `avg_cadence_rpm`, `max_cadence_rpm` | mean, max | |
| `avg_speed`, `max_speed` | `avg_speed_kmh`, `max_speed_kmh` | mean, max | |
| `work_kj` | `work_kj` | sum | |
| `pacing` | `pacing_index` | mean | Second-half / first-half average, % (100 = even) |
| `dropoff` | `dropoff_pct` | last rep vs best | Per effort: % below the best rep. Summary: last vs best |
| `decoupling` | `pw_hr_decoupling_pct` | mean | Per effort, first vs second half W/bpm |
| `hr_recovery` / `hr_recovery(<n>sec\|min)` | `hr_recovery_<n>s` | mean | bpm the HR drops `n` seconds after the effort ends (default 60 s); `null` if the stream ends first |
| `time_below_lt1`, `time_lt1_lt2`, `time_above_lt2` | `time_below_lt1_s`, `time_lt1_lt2_s`, `time_above_lt2_s` | sum | Seconds of the effort's power below LT1 (`< LT1`), between (`LT1 <= p < LT2`) or above LT2 (`>= LT2`), using the activity's LT snapshot; `null` without the needed thresholds |
| `time_below_lt1_hr`, `time_lt1_lt2_hr`, `time_above_lt2_hr` | `time_below_lt1_hr_s`, `time_lt1_lt2_hr_s`, `time_above_lt2_hr_s` | sum | Same, from the heart-rate stream and LT HR |

**Default run metrics (automatic).** Every template run reports real per-run performance metrics
without a `metrics` line, per work effort and in the summary where the data exists: `avg_wkg`
(needs the activity's weight snapshot), `avg_power`, `np_w`, `avg_speed_kmh`, `avg_cadence_rpm` and
`avg_hr_bpm`. Metrics missing a stream are simply omitted. The `metrics` line adds more (e.g. max
values). Static athlete references (FTP / LT1 / LT2 in W/kg) are not run results and are no longer
added to summaries; stored runs that still contain `ftp_wkg`, `lt1_wkg` or `lt2_wkg` render fine
(the keys are hidden). The activity-level metrics grid keeps them as reference values.

Metrics that need a stream the activity lacks are `null`. Fields the engine already
computed for a pattern (e.g. `avg_power`, `pacing_index`) are never overwritten.

## Legacy patterns (`pattern` line)

The four built-in detectors can be written in the DSL by replacing the repeat line with
`pattern <name>` followed by option lines (any order, each at most once). Only `metrics`
may be added; steps, `warmup` and `cooldown` are rejected.

| Pattern | Options | Manifest keys |
|---|---|---|
| `repeated_bursts` | `count N`, `duration 3min ±45sec`, `recovery window 60sec` | `target_count`, `target_duration_sec`, `duration_tolerance_sec`, `recovery_window_sec` |
| `flying_sprint` | `distance 200m` | `distance_m` |
| `standing_start` | `distance 1km` | `distance_m` |
| `sustained_tt` | `distances 2km, 3km, 4km`, `min duration 20min`, `lap 250m` | `distances_m`, `min_duration_sec`, `lap_length_m` |

```
pattern sustained_tt
distances 2km, 3km, 4km
lap 250m
metrics decoupling
```

The manifest uses exactly the keys existing templates already store, so old templates and
stored `template_executions` keep working unchanged. `pattern x` with no options uses the
detector defaults. The five seeded system templates (`tpl_vo2max_3min`, `tpl_track_f200`,
`tpl_track_pursuit`, `tpl_track_standing_start`, `tpl_road_z2_decoupling`) only had their
`dsl_source` filled in; their manifests and results are untouched.

## Time and distance results

Every run reports the result a rider actually judges an effort by (issue #191):

- **Time-keyed efforts** (a duration such as `20min`, and `repeated_bursts`): `distance_m`
  covered in the window and `avg_speed_kmh`, integrated from the speed stream. Summary:
  `best_distance_m`, `avg_distance_m`, `total_distance_m`.
- **Distance-keyed efforts** (a distance such as `3km`, and the legacy `sustained_tt`,
  `flying_sprint`, `standing_start`): `elapsed_time_sec`, the exact time to cover the target
  distance, with the boundary interpolated inside its 1 Hz sample (not whole seconds), plus
  `avg_speed_kmh` and `avg_power`. `estimated_time_sec` carries the same value on custom
  efforts. For `flying_sprint` it is the fastest 200 m (or `distance`) near the peak.
  Summary: `best_time_sec`, `avg_time_sec`, `total_time_sec`.
- Efforts carry `keyed_by` (`time` or `distance`). Without a usable speed stream they get
  `no_speed_data: true` and no distance/time value is invented.

Times are lower-is-better: Compare and the baseline deltas (last run, 90-day and all-time
average) show a faster time in green, and the Templates page stats use the minimum as best.
Times display as race times (`m:ss.ss`), distances in km. Stored executions that predate
these fields still render; the fields simply are not shown for them.

## Track context: lap splits (`lap` line)

`lap 250m` (or `lap 0.25km`) gives a template a lap length, at most once, after the
steps. For every work effort the engine integrates the speed stream (km/h → m/s per
second), interpolates each lap boundary inside its sample and reports:

- per effort: `lap_length_m`, `lap_splits_sec` (seconds per full lap; a trailing partial
  lap is dropped; `null` when the activity has no speed stream)
- summary: `lap_length_m`, `lap_count`, `best_lap_sec`, `slowest_lap_sec`, `avg_lap_sec`

```
1x
work 1km ±10% @ best speed
lap 250m
```

Manifest key: `lap_length_m` (omitted when unused, so existing manifests are unchanged).
Under `pattern sustained_tt` the same `lap` option keeps emitting the legacy
`lap_splits_250m` field and now also `lap_splits_sec` measured from speed.

## Round-tripping

Parsed manifests (`{ repeatCount, steps }`) can be converted back into editable DSL text
with `stringifyIntervalDsl`, which the Template Creator UI uses when loading an existing
template for editing. `stringifyIntervalDsl(parseIntervalDsl(text))` is stable — it
reproduces an equivalent DSL string for any valid input.

## Heart rate and cadence examples

```
3x
work 10min ±10% @ 150-165bpm
recovery 5min ±30% @ <70%HRmax
```

```
4x
work 5min ±15% @ 100-110rpm
recovery 3min ±30% @ <70rpm
```

## Lactate threshold examples

```
4x
work 8min ±15% @ 95-105%LT2
recovery 4min ±40% @ <100%LT1
metrics avg_power, time_lt1_lt2, time_above_lt2
```

```
3x
work 10min ±15% @ 97-103%LT2HR
recovery 5min ±40% @ <100%LT1HR
```

System templates using LT bands: `sys_lt_lt2_intervals_4x8`, `sys_lt_lt2_hr_3x10`,
`sys_lt_lt1_endurance_90`, `sys_lt_over_unders`.
