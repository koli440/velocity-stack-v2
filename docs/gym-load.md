# Gym training load (prototype, issue #336)

**Status: prototype.** `src/lib/gymLoad.js` is a pure calculation. Nothing calls it in the app: gym sessions are still
not counted in fitness (CTL/ATL/TSB queries only include `ride`/`run`), nothing is stored, there is no UI and no migration.
`scripts/gym-load.mjs` prints the breakdown for one session.

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
3. **velocity** - only when there is no history and `mean_velocity_ms` exists. Generic line `1 - (v - 0.25) x 0.65`
   (0.25 m/s ~ 100%, 1.0 m/s ~ 51%). It can only *lower* the rep ceiling: half the gap, at most -0.15. Slow sets stay at the
   ceiling. No per-exercise load-velocity profiles.

`velocity_loss_pct >= 20` -> `velocity_loss_high:<exercise>` **flag** (fatigue marker), never extra load.

**Dynamic / jump / bodyweight / unloaded sets** (load_mode bodyweight/assisted, no weight, or name matches
jump|hop|bound|plyo|skip|throw|slam|sprint|burpee): fixed intensity 0.5 -> 0.25 stress per rep. Timed sets without reps use
duration/4 s as reps. Sets with neither are skipped (`set_skipped_no_reps`).

**Density multiplier** = clamp(sqrt(workingSets per session minute / 0.25), 0.85, 1.15); needs session time >= 5 min.
Working/total/rest time are reported in `density`.

**HR multiplier** = clamp(1 + 0.5 x (avgHr / typicalGymHr - 1), 0.88, 1.12). Typical = median avg HR of the rider's prior
gym sessions (needs >= 3). Skipped otherwise (`hr_skipped_no_reference`) or without HR.

All constants live in `GYM_LOAD_CONSTANTS` (override via `constants`). Calibration target: ~20 working sets x 6 reps at
~80% in 60 min ~ 55-60 (a test keeps a typical hard session within 45-75). Heavy low-volume sessions (5x3 at ~90%) score
low (~10); that is intended by `reps x intensity^2` but is an open question below.

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
- A user setting to include/exclude gym in fitness (default?).
- Jumps/plyometrics: is 0.25 per rep sensible, and should the name heuristic become an explicit set flag?
- Heavy low-volume (max strength / speed-power) sessions score low; add a floor or a higher K at >= 85%?
- History window (all-time best vs. last N weeks) and detraining; min sessions (3) and HR reference (3 sessions).
- Per-exercise velocity profiles from the rider's own data once enough sets with velocity exist.
- Planned gym workouts need a separate estimate (same formula with planned reps/weights, no velocity/HR).
