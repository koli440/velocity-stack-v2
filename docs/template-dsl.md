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
  - `<value><unit>` — target duration, `unit` is `min` or `sec` (e.g. `3min`, `30sec`).
  - `±<tolerance>%` — a percentage tolerance applied to the target duration to get an
    acceptable duration *range*. E.g. `3min ±30%` → the detector accepts windows between
    `126s` and `234s`.
  - `@ <band>` — the power band the window's average power must satisfy (see below).

### Power bands

There are three kinds of band:

1. **Relative `%FTP` band** — evaluated against the *activity's own* FTP snapshot
   (`ftp_at_activity_w`), never the athlete's current/live FTP, so matching stays
   consistent even if FTP has drifted a lot since the ride.
   - Range: `90-110%FTP`
   - Max only: `<55%FTP`
   - Min only: `>80%FTP`
2. **Absolute watts band** — same range/min/max syntax, suffixed `W` instead of `%FTP`.
   Useful for athletes without an FTP set, or when raw power matters more than a
   relative percentage.
   - Range: `250-300W`
   - Max only: `<150W`
   - Min only: `>280W`
3. **`best` / `max` keyword** — no numeric threshold at all. Instead of checking against
   a power band, the detector locates the single highest-average-power window of
   approximately that duration (within the duration tolerance) in the stream. This is
   the right choice for structural, non-repeatable efforts (a decisive climb, a final
   sprint) or for comparing the "same" workout years apart without FTP drift getting in
   the way.

### Validation rules

- `repeatCount >= 1`.
- Duration must be `> 0`.
- Tolerance must be between `0` and `100` (percent).
- At least one `work` step is required.
- For `%FTP`/`W` bands, bounds must be `>= 0`, and when both a min and max are given,
  `min < max`.
- Unrecognized band syntax produces a parse error tagged with the offending line number.

### Matching semantics (detection)

- The detector scans the power stream cyclically (work, then recovery if present, then
  back to work) looking for windows that satisfy each step's duration range and power
  band, up to `repeatCount` times.
- It does **not** require finding the full configured `repeatCount` to produce a result:
  it reports however many complete work(+recovery) cycles were actually found
  (`reps_detected`), alongside the configured target (`reps_target`), so a partial match
  (e.g. "3 of 4 reps") is a valid, useful result rather than a failure.

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

## Round-tripping

Parsed manifests (`{ repeatCount, steps }`) can be converted back into editable DSL text
with `stringifyIntervalDsl`, which the Template Creator UI uses when loading an existing
template for editing. `stringifyIntervalDsl(parseIntervalDsl(text))` is stable — it
reproduces an equivalent DSL string for any valid input.
