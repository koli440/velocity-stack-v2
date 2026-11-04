# Gym training load (prototype, issue #336)

**Status: live (model version 1).** `src/lib/gymLoad.js` is the pure calculation; the load is computed on the server when a
session is saved, stored as an ESTIMATE and counted in fitness / fatigue / form by default (per-rider toggle). `scripts/gym-load.mjs`
still prints the breakdown for one session without storing anything.

## Storage and recompute rule
- **Compute once at save time, store it.** `src/lib/server/gymLoadStore.js` `computeAndStoreGymLoad` reads the session, the rider's
  PRIOR gym sessions (strictly earlier `activity_date`, same `name_key`, owner-filtered) and prior avg HRs, runs `computeGymLoad` and writes
  `activities.training_load` plus `gym_load_model` (model version, NULL = no estimate), `gym_load_at`, `gym_load_stale`, and the
  breakdown / flags / density into `gym_load_details` (jsonb, rider + active coach can read it through `can_view_gym_detail`).
- **No silent rewrites.** Loads of earlier sessions are NOT recomputed when later data arrives (history can shift intensities, but the
  stored number a rider already saw stays). A session is rescored only when (a) it was edited (trigger on `gym_session_edits` sets
  `gym_load_stale`; the editor also calls `POST /api/activities/[id]/gym-load` right after saving, rider or active coach), (b) it is imported or
  repaired (importer, browser import, bulk import, `gymRepair`), (c) it was never scored (self-service backfill below), or (d) an admin rescore after a model version bump.
- **Backfill without manual steps.** `POST /api/gym-load` scores the signed-in rider's never-scored / stale sessions (25 per call, oldest first;
  the Fitness page and the activity page trigger it). `POST /api/admin/gym-load-backfill { userId?, limit?, rescore? }` (admin only) does it for everyone;
  call again while `remaining > 0`. Sessions without sets get no estimate but are marked scored (`gym_load_at`).
- No secrets are added: the routes use the existing service-role key already configured for server jobs.

## In fitness
Gym loads count as ESTIMATED daily load (they feed the estimate share and the hatched bars). `profiles.include_gym_in_fitness`
(default TRUE, Settings: "Include gym sessions in fitness") turns them off; the coach sees the rider's choice ("Gym sessions are not included: the rider chose ...").
Toggle off = the previous ride/run-only queries exactly. Unscored gym sessions count as nothing. Planned gym workouts still have no
load estimate (partial forecast note).

## Why this shape
Riders (even sprinters) lift for strength/power, not to train near failure, so reps-to-failure, session RPE and HR are weak
signals. User RPE/RIR/session-RPE is **not used anywhere** (the fields may exist in the data, the model never reads them).
There is no exercise database; exercises are grouped by `gym_exercises.name_key` only.

## Formula
Per **working** set (warm-ups excluded, like the e1RM code; drop/failure sets count):

    stress = reps x intensity^K            (K = 2)
    load   = SCALE x sum(stress) x densityMultiplier x hrMultiplier     (SCALE = 0.7)

Intensity (%e1RM) source, in order:
1. **history** - `weight / best e1RM` of the same `name_key` from the rider's *prior* sessions (Epley, `estimate1RM`), only
   with >= 3 prior sessions of that exercise. Clamped 0.30-1.05.
2. **reps** - rep-implied intensity `1/(1+reps/30)` (3 reps ~91%, 10 ~75%). A *ceiling*: the set may be far from failure.
   Exercises on this source get a `ceiling_intensity:<name>` flag.
3. **velocity** - only with a per-exercise profile (`constants.velocityProfiles[name_key] = { v0, slope }`, intensity =
   `1 - (v - v0) x slope`), e.g. later derived from the rider's own data. It can only *lower* the rep ceiling: half the gap,
   at most -0.15. There is deliberately **no generic velocity table** (leg press ~0.2 m/s and box squat ~0.55 m/s are both normal).
   Without a profile, velocity is not used for intensity.

**Unilateral assumption.** GPath records the TOTAL reps over both sides (16 lunge reps = 8 per leg) and users must not be asked
to edit reps. So when a working set has `reps > 10` **or** the exercise name matches
`lunge|split squat|step-up|bulgarian|single-leg|one-leg|pistol`, the recorded reps are assumed to be the total: the
intensity estimate (Epley etc.) uses `reps / 2` per side, while stress counts the **total** reps (both sides do the work).
Flag `assumed_unilateral:<exercise>`, `assumedUnilateral: true` in the breakdown. The threshold (`UNILATERAL_REPS_ABOVE`) and the
name list are tunable; a per-exercise "unilateral" attribute could later replace the heuristic. Known side effect: a genuine
bilateral set of 11+ reps is also halved (intensity slightly higher than a true per-rep estimate would be).
Only above 12 reps *per side* is rep-implied intensity considered unreliable and floored at 0.6 (`high_rep_floor:<exercise>`).

`velocity_loss_pct >= 20` -> `velocity_loss_high:<exercise>` **flag** (fatigue marker), never extra load.

**Dynamic / jump / bodyweight / unloaded sets** (load_mode bodyweight/assisted, no weight, or name matches
jump|hop|bound|plyo|skip|throw|slam|sprint|burpee): fixed intensity 0.5 -> 0.25 stress per rep. Timed sets without reps use
duration/4 s as reps. Sets with neither are skipped (`set_skipped_no_reps`).

**Density multiplier** = clamp(sqrt(workingSets per session minute / 0.2), 0.85, 1.15); needs session time >= 5 min.
Working/total/rest time are reported in `density`.

**HR multiplier** = clamp(1 + 0.5 x (avgHr / typicalGymHr - 1), 0.88, 1.12). Typical = median avg HR of the rider's prior
gym sessions (needs >= 3). Skipped otherwise (`hr_skipped_no_reference`) or without HR.

All constants live in `GYM_LOAD_CONSTANTS` (override via `constants`). Calibration target: ~20 working sets x 6 reps at
~80% in 60 min ~ 55-60 (a test keeps a typical hard session within 45-75). Heavy low-volume sessions (5x3 at ~90%) score
low (~10); that is intended by `reps x intensity^2` but is an open question below.

## Real example (owner's GPath session 2026-11-03, 69 min, avg HR 121, no history)
Box jump 3 sets (70-90 kg, dynamic, 0.50, stress 6.0, flag dynamic_with_weight); Box squat 3 sets (0.79 reps, 15.0);
Barbell Lunges 3 sets of 16/16/22 total reps = 8/8/11 per leg (0.77 reps, 31.7, assumed_unilateral); Legpress 4 sets (0.79 reps, 19.9).
Density x0.967 (13 sets in 69 min vs 0.2/min); HR multiplier 1.0 (no typical-HR reference yet). **Load 49.2.** Fixture: `src/lib/__tests__/fixtures/gpath-2026-11-03.json`.

## Output
`{ load, breakdown: [{ name, name_key, workingSets, intensity, source (history|reps|velocity|dynamic|mixed), sources, stress }],
density, flags, inputsUsed }`. Inputs: the shape of `fetchGymDetail()` exercises, `durationS`, `avgHr`,
`summarizeHistory(prior exercises)`, `typicalGymHr(prior avg HRs)`.

## Running it for a session
Read-only, uses the rider's own token (RLS), no service-role key:

    SUPABASE_URL=... SUPABASE_ANON_KEY=... USER_ACCESS_TOKEN=<access_token of the signed-in session> \
      node scripts/gym-load.mjs <activity-id>   # or --latest
    node scripts/gym-load.mjs --file session.json   # offline sample, no env

## Open questions
- CTL vs ATL: same load into both (like TSS), or damp gym in CTL (neuromuscular fatigue is short-lived, little aerobic adaptation)?
- TSS scaling: is ~60 for a hard hour right, or should strength be lower relative to riding?
- ~~A user setting to include/exclude gym in fitness~~ done: default ON, per rider.
- Jumps/plyometrics: is 0.25 per rep sensible, and should the name heuristic become an explicit set flag?
- Heavy low-volume (max strength / speed-power) sessions score low; add a floor or a higher K at >= 85%?
- History window (all-time best vs. last N weeks) and detraining; min sessions (3) and HR reference (3 sessions).
- Per-exercise velocity profiles from the rider's own data once enough sets with velocity exist.
- Planned gym workouts need a separate estimate (same formula with planned reps/weights, no velocity/HR).

## Exercise catalogue (model v2)

Exercises can link to `exercise_catalogue` (`gym_exercises.catalogue_id`). When linked, the model uses the catalogue instead of guessing:

- `unilateral` (reps recorded as total across both sides) replaces the name regex / `reps > 10` guess; no `assumed_unilateral` flag.
- `movement_type` (`strength` | `dynamic` | `jump`) decides dynamic vs strength; non-strength is dynamic.
- Jump height (`metrics.height_cm`, cm) scales dynamic intensity: `clamp(0.5 * (1 + 0.3 * (h/50 - 1)), 0.4, 0.65)`. Added kg on a catalogue jump does not raise `dynamic_with_weight`.
- History is keyed by catalogue id (`c:<id>`), so aliases ("Legpress", "Leg press") share one history; unlinked exercises still use `name_key`.

Unlinked (free text) exercises keep the old fallback. `GYM_LOAD_MODEL_VERSION` is 2; the migration marks newly linked scored sessions `gym_load_stale` and the self-service recompute refreshes them.
