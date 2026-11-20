# Macro planner (coach tool)

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
- **Races**: the planner has no free-form race entry; see "Races come from the calendar".
- **Location**: coach page per athlete, `/coach/<riderId>/planner` (needs an ACTIVE coaching relationship). No calendar bands in v1.
- **v1 scope**: one A race, mesocycle templates (3+1, 2+1, 4+1, custom), load projection (planned vs actual CTL / ATL / TSB to race
  day), feasibility check, taper model by race length with a predicted race-day form (TSB) that is always labelled an *estimate*.
- **Athlete**: read-only timeline at `/training-plan` (only a plan the coach has *published*, only while that coach is the active coach).
- **Not built** (decided): calendar bands, athlete-editable plans, and the planner for self-coached athletes (a premium coach feature;
  `coach_id <> rider_id` plus `is_coach_of` make it impossible server-side). Phase 2 (illness/injury, adherence, B/C races, availability,
  sharing, Lab hint) is described in "Adapting the plan".

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

## Adapting the plan (phase 2, same `macro_planner` flag)
Migration `20270187000000_macro_planner_adapt.sql`, engine `src/lib/macroPlannerAdapt.js` (pure, unit tested), UI `src/components/PlannerAdapt.js`.
Principle: the engine only SUGGESTS. Every option carries a recomputed projection, feasibility verdict and estimated race-day form next to the
unchanged plan; nothing changes until the coach applies one, and `macro_plan_apply` replaces the weeks and writes an append-only row in
`macro_plan_audit` (before/after weeks and goal) in one transaction. Clients have no table privileges; every RPC checks flag and relationship.
- **Disruptions** (`macro_plan_disruptions`: illness/injury, mild/moderate/severe, start, optional end, note). Return ramp as a share of the pre-break
  weekly TL (mean of up to 4 undisturbed weeks before the break, else the planned target): the break length is multiplied by the severity
  (1 / 1.5 / 2) and picks a tier, e.g. up to 7 effective days illness 50/70/85 %, injury 60/80/90 %; longer breaks give longer, lower ramps; illness is
  always more conservative. Open-ended disruptions assume they end today. Options: **shift forward** (ramp, then the normal progression at the ramp
  ceiling), **compress** (climb up to 12 %/week to regain the original peak; higher risk, feasibility says so), **lower the goal** (gentler ramp
  and a goal CTL equal to what it reaches). Weeks overlapping a disruption are excluded from the baseline and from adherence. The UI shows a
  "not medical advice" notice.
- **Adherence**: planned vs actual TL for completed weeks. Green 85-115 %, amber 70-130 %, else red; weeks with a disruption or no target are not
  scored. A review is proposed (`macro_plan_reviews`, once per week, dismiss/done are never reopened) when the last two scored weeks are red in the
  same direction or the last three are all off target in the same direction. The review offers a "rebase" option from the recent actual load.
- **B and C races** (`macro_plan_races`, before the A race; selected from the athlete's calendar): B = race week at 75 % TL with a hard race day, then a recovery week; C = train through, race
  day hard. Races past, in the A taper, outside the plan or in the same week as a higher-priority race are ignored (reason returned). Applied on
  generation and inside every option.
- **Availability** (`macro_plan_availability`: Monday, 0-100 %, reason): suggests scaling the week's target (<= 50 % removes hard days, 0 % = rest).
- **Sharing** (`macro_plans.share_reasoning`, default off): per-week and plan rationale are returned by `my_macro_plan` only when on. Disruptions,
  availability, reviews and the audit trail are never returned to the athlete.
- **Lab hint**: the Lab phenotype (power profile of the last 90 days and weight) shows a text hint for the focus labels; it never edits the plan.
All of these are estimates, not predictions or medical advice.

## Races come from the calendar
Migration `20270188000000_macro_planner_calendar_races.sql`, helpers `src/lib/macroPlannerCalendar.js`, harness `macro-planner-calendar-adversarial.mjs`.
The A race and the B/C races are existing `calendar_races` rows of the athlete (see docs/coaching.md for calendar races). The coach SELECTS one and
the planner role (A, B, C) is the planner's own; the calendar's own A/B/C priority is not used. An athlete with no suitable race gets an empty state
with a link to `/coach/<riderId>/calendar`, where the coach adds the race under the existing calendar permissions (rider or active coach).
- **Link**: `macro_plans.race_id` and `macro_plan_races.race_id` reference `calendar_races(id) ON DELETE SET NULL`. `macro_plan_save` requires a
  `race_id` that belongs to the plan's athlete; `macro_plan_races_set` takes `[{race_id, priority}]` (not the A race, before the A race). Name and date are copied
  from the calendar server-side (payload names/dates are ignored), so the engine and the athlete page keep working on the same fields.
- **Follows the calendar**: triggers on `calendar_races` copy a rename or date change into the plan. A date change sets `attention = 'race_moved'`;
  the coach checks the weeks and marks the plan reviewed (`macro_plan_attention_ack`) or saves it again with the weeks ending in the new race week.
- **No silent loss**: deleting a linked race keeps the plan and sets `attention = 'race_deleted'` (A race; the stored name/date remain visible, save is
  blocked until another calendar race is selected) or marks the B/C row `missing` (shown with a warning, ignored by the engine, derived flag `minor_race_deleted`;
  remove it to continue). The triggers swallow their own errors, so the calendar can never be broken by the planner, and they touch no row when no plan exists.
- **Existing plans** (created before this change) are linked to a calendar race of the same athlete with the same date and name; otherwise they are
  flagged `race_unlinked` / `missing` and the coach selects the race.
- **Athlete**: `my_macro_plan` strips `attention`, race ids and missing B/C races.
- **Race length**: calendar races have no distance/duration column (only the free-text "Format / distance" and a discipline), so the taper's `race_length`
  stays a planner setting; the calendar's format text, location and date are shown as context.

## Rules followed
Owner-scoped queries (`scopeToOwner`, explicit rider ids), additive idempotent migrations with new higher versions, adversarial DB harness
`scripts/db-harness/macro-planner-adversarial.mjs` and `macro-planner-adapt-adversarial.mjs`, pure logic in `src/lib` with unit tests, news entry, no external secrets.
