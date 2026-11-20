# Macro planner (coach tool, v1)

Long-term, high-level planning towards ONE A-race date, tied to the athlete's real fitness history. No workouts: the
unit is a **planned week** (target TL, focus label, note and a rough hard/easy/rest day shape). Coaches plan; the
athlete gets a read-only timeline.

**Dark behind the `macro_planner` feature flag (default off).** With the flag off nothing changes for anybody: no menu
item, no pages that answer, every RPC refuses, and the tables stay empty.

## Decisions
- **Load metric**: the platform's existing total TL (`activityLoad` / `dailyLoads` in `src/lib/fitnessForm.js`; includes gym and other
  sports where the platform already counts them, honours the rider's "include gym in fitness" setting). The coach reads the athlete's
  history only through the coach-gated `coach_fitness_activities()` RPC (see docs/coaching.md). With too little history the coach enters
  a manual starting weekly TL instead.
- **Location**: coach page per athlete, `/coach/<riderId>/planner` (needs an ACTIVE coaching relationship). No calendar bands in v1.
- **v1 scope**: one A race, mesocycle templates (3+1, 2+1, 4+1, custom), load projection (planned vs actual CTL / ATL / TSB to race
  day), feasibility check, taper model by race length with a predicted race-day form (TSB) that is always labelled an *estimate*.
- **Athlete**: read-only timeline at `/training-plan` (only a plan the coach has *published*, only while that coach is the active coach).
- **Not in v1** (do not build): illness / injury disruption handling and replanning (next step; suggest-only, the coach approves),
  B/C races, calendar bands, athlete-editable plans.

## Flag (same mechanism as `coach_module`)
`20270186000000_macro_planner.sql`:
- `macro_planner_settings` (single row, `global_enabled` default FALSE) and `macro_planner_allowlist` (per account). No client privileges.
- `macro_planner_enabled(user)` = global OR allow-listed; `macro_planner_require()` raises `Macro planner is not enabled` and is called first
  in every coach RPC (the flag is enforced in the database, the UI only mirrors it via `my_macro_planner_enabled()`).
- Admin RPCs `admin_macro_planner_status / _set_global / _allow` (admin only), page `/admin/macro-planner`, toggled exactly like the coach module.
- The athlete RPC `my_macro_plan()` returns nothing unless the **plan's coach** has the flag; there is no athlete-side flag, so switching the
  coach off hides the plan from the athlete as well.

## Data model
- `macro_plans` (one per coach + athlete, unique `(coach_id, rider_id)`): `race_name`, `race_date`, `race_length`
  (`short` < 1 h, `medium` 1-3 h, `long` 3-6 h, `ultra` > 6 h), `template` (`3+1`, `2+1`, `4+1`, `custom`), `build_weeks`,
  `recovery_weeks`, `ramp_ceiling_pct` (default 7, 0-15), `start_weekly_tl` (the baseline the plan starts from),
  `baseline_source` (`history` | `manual`), optional `goal_ctl`, `status` (`draft` | `published`), stamps.
- `macro_plan_weeks` `(plan_id, week_start)`: `week_start` is a Monday; `kind` (`build` | `recovery` | `taper`), `target_tl` (0-5000),
  `focus` (<= 40), `note` (<= 500), `day_shape` (7 letters Mon..Sun from `H` hard, `E` easy, `R` rest), `tl_overridden`
  (the coach changed the engine's number).
- No client table privileges. All access goes through SECURITY DEFINER RPCs that check `macro_planner_require()` then `is_coach_of(rider)`
  and scope by `auth.uid()`:
  `macro_plan_get(p_rider)`, `macro_plan_save(p jsonb)` (atomic upsert of the plan + replacement of all weeks, <= 60 weeks, validates
  dates/shape/limits; author and stamps come from `auth.uid()`), `macro_plan_publish(p_plan, p_published)`, `macro_plan_delete(p_plan)`,
  `my_macro_plan()` (athlete, read-only).
- Ending the relationship revokes access immediately (`is_coach_of` is evaluated on every call); the plan row stays and is reachable again
  if the same pair is re-activated.

## Planning engine (`src/lib/macroPlanner.js`, pure, unit tested)
Weeks run Monday to Sunday (local day keys, like `fitnessForm.js`).
- **Baseline**: the last 6-12 complete weeks of weekly TL, CTL and weekly CTL ramp. Weeks below 40 % (likely sick, holiday or off) or above
  175 % (outlier) of the median are excluded and reported. Needs >= 6 usable weeks, otherwise status `manual` and the coach enters the
  starting weekly TL. The *sustained ramp* is the best 4-week average CTL gain per week over windows without excluded weeks (needs >= 10 weeks of
  history; otherwise unknown and the platform default of 5 CTL/week (`RAMP_HIGH_PER_WEEK`) is used).
- **Generation**: mesocycle = `build_weeks` build weeks followed by `recovery_weeks` recovery weeks (template defaults, custom editable).
  The first build week is the baseline; every later build week is `previous build x (1 + step)`, a recovery week is 70 % of the previous
  build week. `step` is the ramp ceiling (default 7 %) or, when a goal CTL is set, the smallest step that reaches it (capped at the ceiling).
  A recovery week directly before the taper is turned into a build week. The coach can override any week; overrides are kept in the
  stored week (`tl_overridden`) and flagged when they break the ceiling.
- **Taper** by race length (fraction of the peak build week, counted back from race week): short 1 week (60 %), medium 2 weeks (75 %, 55 %),
  long 2 weeks (70 %, 50 %), ultra 3 weeks (80 %, 60 %, 45 %). Race week has the race day as `H` and rest the day before.
- **Projection**: weekly target spread over the week by the day shape (H 2.0, E 1.0, R 0 weights), then the same CTL (42 d) / ATL (7 d) / TSB
  formulas as the platform. Three series to race day: `actual` (real loads, to today), `plan` (planned loads only, from plan start) and
  `forecast` (real up to today, plan afterwards). Race-day form is the forecast TSB on race morning (previous day's CTL - ATL, as everywhere
  else) and is shown as an estimate with the platform's `formStatus` label.
- **Feasibility**: planned ramp (peak 4-week average CTL gain/week) vs the sustained ramp. `ok` up to 100 %, `stretch` up to 125 %, otherwise
  `unrealistic`; any planned ramp above `RAMP_WARN_PER_WEEK` (8) is also `unrealistic`. A goal CTL that cannot be reached within the ceiling
  is flagged separately. Also checked: weeks that jump more than the ceiling over the previous comparable week, mesocycles without recovery.

## UI
Coach page `/coach/<riderId>/planner` (menu item "Planner", icon `trend`, **only when `macro_planner` is on**; coaches without the flag see nothing and
the page answers "not available for your account yet"). Same cards, inputs and buttons as the coaching screens (`AdminUi`). Setup (race, template,
ceiling, goal, starting TL), generated week table with editable target / focus / note / day shape, projection chart, feasibility and race-day estimate,
publish / unpublish. Athlete: `/training-plan` (menu item shown only when a published plan exists), read-only.

## Rules followed
Owner-scoped queries (`scopeToOwner`, explicit rider ids), additive idempotent migrations with new higher versions, adversarial DB harness
`scripts/db-harness/macro-planner-adversarial.mjs`, pure logic in `src/lib` with unit tests, news entry, no external secrets.
