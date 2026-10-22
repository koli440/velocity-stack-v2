# Coaching (step 2: relationships, consent, read access)

- Any account can coach; no flag. Either side initiates (coach: *Invite as athlete*, rider: *Request as my coach*);
  the rider's acceptance (or own request) is the consent. Self-coaching and blocked pairs are refused. Bots are allowed (see *Coaching with bots*).
- A rider has at most one active coach. Accepting a new coach's invite swaps atomically (advisory lock + unique
  index); the UI warns first, naming the coach being replaced, and that coach gets a `coach_replaced` notification.
  `request_coach` is refused while the rider already has a coach, so a coach's acceptance never replaces one.
- Access has no expiry. The rider revokes, or the coach leaves (`end_coaching`); a block ends it.
- Declines are silent (declined rows look "pending" to the requester, 30-day re-request cooldown, max 25 pending per user).

**Notification links** (`notificationHref` in `src/lib/notifications.js`, computed client-side, so old rows work too):
`follow_request` → `/riders?tab=following#follow-requests`; `new_follower`/`follow_approved` → the rider's profile;
`coach_invite`/`coach_request`/`coach_accepted`/`coach_ended`/`coach_replaced` → `/settings#coaching`; `coach_edited` →
`/settings#physiology`. Both target pages scroll to the section and say so when the request is no longer pending.
Follow notifications are deduplicated (one unread per recipient + actor + type, none across a block) by a trigger.

## Privacy rules
- Coaches read everything of the athlete, including private activities, curves, templates, PBs and histories.
- Activities are read only via `shared_activities`: privacy-zone coordinates stay masked exactly as for other riders;
  raw GPS and `raw_file_url` never leave the owner-only `activities` table.
- Never exposed: connection tokens, `profile_secrets`, email. `get_athlete_profile` returns training fields only.
- Known gap: `shared_activities` does not expose later snapshot columns (e.g. `ftp_at_activity_w`).

## Pushing planned workouts to Intervals.icu (`20261208000000_planned_workout_intervals_push.sql`)
The rider's ACTIVE coach (not pending/ended/blocked) can push, update and remove the athlete's planned workouts in the ATHLETE's Intervals.icu
calendar from the planned workout dialog. The server checks access through RLS on `planned_workouts` and then uses the athlete's connection
with the service role; the coach never sees the API key, the athlete id or the connection row (`planned_push_context` only returns
`connected` / `auto_enabled`). The automatic push is the rider's own setting (coaches cannot change it). See docs/integrations.md.

## Own-account queries must filter by owner (data isolation)
**Queries on own-account pages must always filter by owner explicitly; RLS coach read access is only for athlete context.**
The `*_select_coach` policies (PBs, aero tests, templates, run results, histories, curves, ...) are OR-ed with the owner
policies, so an unfiltered `select` by a coach returns their own rows PLUS every coached rider's. On `/pb-vault`, `/aero-lab`,
templates, dashboard, stats, search etc. always add `.eq('user_id', <signed-in user>)` (helper: `scopeToOwner` in
`src/lib/ownerScope.js`; templates: `visibleTemplatesFilter`). Athlete-context pages (`/coach/<riderId>/...`) pass the rider id
explicitly. Never rely on RLS alone to scope a read.

## Coach edits (step 3, `20261130000000_coach_edits.sql`)
Consent is wide: besides reading everything, the ACTIVE coach (`is_coach_of`) may write the rider's physiology and
training settings, and **only** those:
- `ftp_history`, `weight_history`, `lactate_threshold_history`, `power_zone_history`: extra INSERT/UPDATE/DELETE RLS
  policies (`*_coach`) next to the `*_own` ones, both USING and WITH CHECK require `is_coach_of(user_id)`.
  Moving a row to another rider is refused by trigger. Derived values (activity FTP/weight/zone snapshots, IF, TL,
  `profiles.ftp_w`) follow through the existing SECURITY DEFINER triggers.
- Profile training defaults (`home_track_id`, `default_chainring`, `default_cog`, `crank_length_mm`): only through
  `coach_update_athlete_profile(p_rider, p_changes jsonb)`. There is no coach UPDATE policy on `profiles`; any other
  key (FTP mirror, privacy zone, admin flag, names, avatar...) is rejected.
- Never writable by a coach: activities, connections, secrets, templates, PBs, aero tests, follows, blocks,
  relationships, notifications.

**Labelling and audit.** Triggers stamp `changed_by`, `changed_at`, `set_by_coach` on every history row (and
`training_set_by/at/by_coach` on the profile) from `auth.uid()`; client-supplied values are overwritten, so they cannot be
forged. An edit by the rider clears the label. Every coach edit is also written to `coach_edits` (rider_id, coach_id,
table, row, action, old/new values). The rider reads all of it, a coach only their own edits while the relationship is
active; no client can write the table. The UI shows a "set by coach" badge where those values appear.

**Notifications.** A coach edit creates a `coach_edited` notification for the rider. At most one *unread* one exists per
coach/rider (partial unique index); further edits only bump its timestamp, so editing is never spam.

**Revocation** takes effect immediately: `is_coach_of` is evaluated on every statement.

## Coach UI (step 3)
Context is URL based, never stored (`src/lib/coachContext.js` parses/builds the paths):

| Route | Shows |
|---|---|
| `/coach` | Dashboard: athletes with last activity, 7-day sessions/time/distance/load, pending invites |
| `/coach/<id>` | Overview: current FTP / weight / LT1 / LT2 (with coach badges), recent activities, audit list |
| `/coach/<id>/calendar` | `ActivityCalendar` for the athlete (replaces step 2's `/calendar?rider=`, which redirects) |
| `/coach/<id>/activities[/<activityId>]` | Athlete activities (masked `shared_activities`) and detail |
| `/coach/<id>/pb-vault` | Read-only list (coach access is SELECT-only) |
| `/coach/<id>/physiology` | The four history panels + gear defaults, editable by the coach |

- `app/coach/[riderId]/layout.js` checks `get_athlete_profile` (which only answers for an active coach), shows the
  persistent indigo banner "Coaching: <Name> - Exit" and the athlete tab bar; anyone else sees "not coaching".
- The top-right user menu has a "Viewing as" section (Me + athletes, only when the user has athletes).
- In athlete context (`/coach/<id>/...`) the sidebar/mobile drawer shows ONLY athlete pages (Overview, Activities, Calendar,
  Personal Bests, Templates, Physiology) plus "Coach dashboard" (`sidebarItems`). The coach's own pages are hidden: telemetry,
  tools, About/Feedback, own settings, search, Add/Sync, notifications bell, footer links, admin link (`chromeVisibility`).
  Leaving is always explicit: banner "Exit" / "Coach dashboard", and the user menu "Viewing as" (Me / athletes / Coach dashboard).
  In-page links of reused components (calendar chips, activity detail back link, template runs, curve tooltips) keep the
  context via `contextualHref` / `activityBackHref`. The Coach/Rider toggle was removed.
- Rider side: history rows and the "Gear defaults" heading show a "Set by coach <name> - date" badge
  (`CoachBadge`), settings lists the audit trail ("Coach changes"), and the `coach_edited` notification links to
  `/settings#physiology`.
- All of this is convenience only; every write is checked by RLS / SECURITY DEFINER functions (see above).

Choices made: "weekly volume" is the last 7 days; PBs/templates are read-only in athlete context; activity detail
opens the existing page (which falls back to the masked view) under `/coach/<id>/activities/<activityId>`.

## Coaching with bots (`20261201000000_coaching_with_bots.sql`)
Testing aid, since no real people are available. Bots cannot answer requests, so the SECURITY DEFINER paths answer for them:
- `invite_athlete(bot)`: the bot (rider) accepts at once. Same atomic logic as `accept_coaching` (shared internal
  `coaching_accept_as`): an existing coach of the bot is replaced and notified (`coach_replaced`), the inviter gets `coach_accepted`.
  So any user can take over a bot athlete; that is intended for a shared test fixture.
- `request_coach(bot)`: the bot (coach) accepts at once; still refused while the rider already has a coach.
- Bots never initiate (refused in `create_coaching_request`), blocks (either direction) look like "Rider not found",
  self-coaching and one-active-coach-per-rider hold. `coaching_accept_as` and `create_coaching_request` are not client-callable.
- Coach dashboard, `/coach/<botId>`, calendar and physiology edits work on the bot's generated rides; the bot receives
  `coach_edited` notifications (harmless).
- A bot coach edits a rider's data via the SQL-only `bots_coach_edit` (see docs/bots.md), executable by `service_role`/migrations only.

## Coach template runs (`20261202000000_coach_template_runs.sql`)
The active coach (`is_coach_of`) can run templates on an athlete's activity (`/coach/<id>/activities/<activityId>`, same picker).
- **Stored on the rider's account** (`template_executions.user_id = rider`). Stamped by the DB (`by_coach`, `run_by_coach_id`,
  `coach_key`); the only coach write path is `coach_save_template_run` / `coach_delete_template_run` (SECURITY DEFINER,
  pinned search_path, check `auth.uid()` + `is_coach_of`). `coach_template_run_inputs` gives the evaluation inputs (no GPS).
  No coach INSERT/UPDATE/DELETE RLS policy exists; riders cannot forge or clear the stamp.
- **Templates**: coach's own + system only (never the rider's, nor others' public ones).
- **Privacy**: runs keep a snapshot of template name/slug/category only (kept in sync on rename). `analysis_templates` RLS is
  unchanged, so the rider never reads the coach's manifest/DSL; rider-facing APIs (activity runs, history, stats) read the
  snapshot, not a join. A rider and a coach run of the same template on one activity coexist (unique on activity, template, coach_key).
- **Delete / re-run**: coach only his own runs while active; the rider can delete any run on his account (re-run only own).
- **Stats**: coach runs sit on the rider's account, so they appear in the rider's stats/history/compare (filter *By coach*,
  badge "run by coach <name>") and never in the coach's own stats or his template's usage count (`user_id = coach` only).
- **PB Vault**: never; the button is hidden for coach runs and the vault has no link to executions.
- **No notification.** After the relationship ends runs stay, labelled with the coach's name, or "former coach" if the account is gone.
  Deleting a template keeps coach runs (`template_id` becomes NULL, name snapshot stays).

### Template Runs card on the activity page (collapsing)
The card and each run inside it are collapsible (UI only, no DB). The card's collapsed state is kept in `localStorage`
(`vs.templateRuns.collapsed`, per browser); runs default to: one run open, several runs → only the most recent open, the
rest show a one-line summary (result · verdict). Same behaviour in own and coach/athlete context. Logic: `src/lib/templateRunsCollapse.js`.

### Templates section in athlete context (`/coach/<id>/templates`)
Shows the template runs the **coach** made on **this athlete's** activities, grouped by template (own + system, with a
"yours" / "system" / "template removed" label), with usage stats and a run list titled "your runs on <athlete>".
- Read through `GET /api/templates/stats?rider=<id>` and `/api/templates/stats/runs?rider=<id>` (and `/api/templates/<slug>/history?rider=<id>&coach_only=1`),
  which add `by_coach = true AND run_by_coach_id = <caller>` to the existing RLS-protected read (`template_executions_select_coach`,
  `is_coach_of`). No new migration/policy: the athlete's own runs and other coaches' runs are never returned; a stranger or an
  ended/pending/blocked coach gets nothing (RLS), and access is lost immediately on revocation.
- Without `?rider=` (the coach's own Templates page) only `user_id = coach` rows count, so coach runs on athletes never appear in the coach's own stats.
- Run rows link to `/coach/<id>/activities/<activityId>` (context href); the coach deletes / re-runs there (existing rules).
  PB Vault sending stays hidden for coach runs. The athlete's own templates are not listed (definitions stay private).
- Choice: an all-athletes-per-template view is not provided.

### Rep analysis in athlete context (#283)
The activity page in athlete context (`TemplateRunsSection` with `riderId`) uses the same per-effort view as the rider: reference selector (previous run, personal best, median of the last 5, custom run), headline verdict, rep table with ghost line, fade curve and metrics, flags, HR recovery and trend. History comes from `/api/templates/<slug>/history?rider=<id>` (unchanged RLS: `is_coach_of`). The coach's chosen reference is stored in `template_reference_prefs` with `scope_id = athlete`, readable only by the coach himself (never by the athlete or other coaches); the write policy requires an active relationship, so pending/ended/blocked coaches and strangers cannot save one. Coach runs are only compared with the history the viewer could already read, and never enter the coach's own stats.
The one-off re-run job (`/admin/template-reruns`) keeps coach runs as coach runs: `by_coach`, `run_by_coach_id`, `coach_key` and the owner are verified unchanged, and it evaluates them without GPS, like `coach_template_run_inputs`.

## Calendar notes (step 4a, `20261205000000_calendar_notes.sql`)

Short day notes on a rider's calendar - e.g. "can train Tue/Thu evenings", "ill", "injury", "vacation", "work" - so the coach can plan the week.
- **Shape**: one note = one rider, one day, a title (1-80 chars) and a text (<= 1000). No type, no date ranges, max 20 notes per rider and day.
- **Who**: the rider and the rider's ACTIVE coach (`is_coach_of`, block-aware) can read, add, edit and delete ANY note on that calendar
  (the coach may change the rider's notes and vice versa). Enforced by RLS on every statement, so revocation is immediate.
  Pending / declined / ended / blocked coaches, other riders' coaches, followers and strangers get nothing. Notes are never in the feed,
  public profile or any follower-visible view.
- **Author labels**: `created_by` / `updated_by` / `set_by_coach` are stamped by a trigger from `auth.uid()`; clients cannot even name these
  columns (column privileges) and the trigger overrides them. A note cannot be moved to another rider. The calendar labels notes with the
  author's name ("You" for the viewer, "former coach" when the coach account is gone / unidentifiable) and "edited by ..." when the other party changed it.
- **Lifecycle**: notes stay on the rider's calendar when the relationship ends or the coach account is deleted (`created_by` -> NULL, `set_by_coach` stays TRUE).
  Deleting the rider deletes them. No notification.
- **UI**: shown first in the day cell of the month calendar (amber chip with the title, full text in the hover title); click opens a dialog to view/edit/delete,
  the "+" in the day header adds one. Same component on `/calendar` and `/coach/<riderId>/calendar`; notes are fetched for the visible grid range together
  with the activities. Works for bot athletes. Planned workouts (step 4b) share the day cell as `events` of kind `planned`.
- Pure logic and the data helpers: `src/lib/calendarNotes.js` (tests in `src/lib/__tests__/calendarNotes.test.js`).


## Calendar races (step 4c, `20261210000000_calendar_races.sql`)

A race / event on ONE day of a rider's calendar ("A race in 6 weeks": taper, peak). Single-day only in v1.
- **Shape**: name (1-80), date, optional start time, discipline `ride|track|other`, priority `A|B|C` (A = main goal), optional location (<= 120),
  distance / format note (<= 200), notes (<= 1000); max 10 races per rider and day.
- **Who**: same as notes - the rider and the rider's ACTIVE, non-blocked coach (`is_coach_of`, checked per statement) read, add, edit and delete ANY race on
  that calendar; everyone else (pending / ended / blocked coach, other riders, followers, strangers) gets nothing. Not in the feed or public profile.
- **Stamps**: `created_by` / `updated_by` / `set_by_coach` from `auth.uid()` in a trigger (clients cannot name them); `ON DELETE SET NULL` on both, so a deleted
  coach shows as "former coach". `rider_id` is immutable. Races survive the end of coaching. No notification.
- **Activity link** (`activity_id`, `ON DELETE SET NULL`): "this ride was the race". The trigger requires the activity to belong to the race's rider (a coach cannot
  link anything else; a foreign or unknown id fails with "Activity not found"), and an activity can be the race of at most one race (unique index). The
  **same-day** rule is a UI rule (no server timezone, like planned workouts): the dialog only offers activities of the chosen day and drops the link when the date moves.
- **UI**: 🏁 button in the day header next to "+" (plan workout) and 📝 (note) opens `CalendarRaceDialog`; races are priority-coloured chips (A red, B orange, C grey)
  at the top of the day cell and listed in the week summary column; click a chip to edit / delete. A linked activity's chip is shown as the race (flag, race name,
  priority colour). Same component on `/calendar` and `/coach/<riderId>/calendar`; own-account queries filter `rider_id` explicitly.
- Out of scope: Intervals push, results tracking, multi-day events, "days to next A race" hint.
- Pure logic and data helpers: `src/lib/calendarRaces.js` (tests in `src/lib/__tests__/calendarRaces.test.js`).


## Planned workouts (step 4b, `20261206000000_planned_workouts.sql`)

Single workouts planned on a rider's calendar (no recurrence, no multi-week plans yet).
- **Who**: the rider and the rider's ACTIVE coach (`is_coach_of`, block-aware, per statement -> revocation is immediate) can read, plan, edit, move, skip, link/unlink and delete
  ANY planned workout on that calendar (each other's too). Pending / declined / ended / blocked coaches, other riders' coaches, followers and strangers get nothing.
  Never in the feed, public profile or any follower-visible view. No notification, not in realtime.
- **Definition**: date + discipline (`ride|track|gym|other`) + title + optional notes + an optional **snapshot** of the workout's DSL text. The planning dialog has an editable DSL box (parsed live with the template editor's
  parser, link to `/dsl-guide`); choosing a template (the "Add template run" picker: search, favorites, recents, preview; own + system templates only) merely pre-fills it.
  The client sends DSL + parsed manifest + optional template name (display only) to `planned_workout_create` / `planned_workout_set_structure`, which check size and shape
  (DSL <= 4000 chars, no control characters, manifest object <= 20 kB, <= 50 steps, name <= 120). It is a copy, not a live reference. The RPCs never read `analysis_templates`,
  so no template row of a coach or rider is exposed - only the snapshot and the template *name*; the rider sees the full structure of workouts planned for them.
  The manifest is display-only (summary), never executed.
- **Stamps**: `created_by` / `updated_by` / `set_by_coach` come from `auth.uid()` in a trigger; clients cannot name those columns. Label: "planned by coach <name>",
  "planned by former coach" when the account is gone. Workouts survive the end of coaching and coach account deletion (FKs `SET NULL`).
- **Status**: `planned | skipped` stored; completed = linked to an activity; **missed** = past + unlinked + not skipped, derived in the UI.
- **Linking**: the app only *suggests* a match (`suggestMatches`: same day + discipline, one-to-one); a rider or coach confirms or links/unlinks manually
  (`planned_workout_link` / `_unlink`). The activity must belong to the same rider; linking is **same day only** (enforced in the UI via `linkableActivities`, any discipline, matching discipline first; the server has no timezone and only checks ownership/uniqueness); an activity completes at most one workout and a workout has at most one activity (unique index).
  Deleting the activity only clears the link. Linking clears "skipped".
  **Unlink** (dialog, rider and active coach; `planned_workout_unlink` clears `activity_id`, stamps `updated_by` from `auth.uid()`) returns the workout to its derived state:
  `planned` (today/future) or `missed` (past, not skipped); `skipped` is untouched. Intervals.icu push rows are not modified by link/unlink; an unlinked workout is simply pushable again.
  **Status has one source**: `plannedStatus()` (linked = `completed` always; then skipped; past day = `missed`; else `planned`). The calendar chip, the dialog, the push controls and the week summary all use it,
  and the calendar recomputes it when the day rolls over. **Replaced activities keep their link** (#284): when an import replaces a lower-priority copy of a ride
  (e.g. Strava -> Intervals.icu), `planned_workouts_relink_activity(old, new)` (`20261226000000_planned_workout_relink_on_replace.sql`) moves the link before the old row is deleted
  (`ON DELETE SET NULL` used to turn the workout into "missed").
- **Limits**: title 80, notes 2000, DSL 4000 chars, manifest 20 kB, 20 workouts per rider and day.
- Pure logic and data helpers: `src/lib/plannedWorkouts.js` (tests in `src/lib/__tests__/plannedWorkouts.test.js`).

### Planned workouts UI

`ActivityCalendar` (used by `/calendar` and `/coach/<riderId>/calendar`) fetches the visible grid range of planned
workouts next to activities and notes. Chips are styled per status (planned dashed blue, completed green, skipped
struck through, missed red) and can be dragged to another day; `PlannedWorkoutDialog` (`+` button on a day = plan workout, 📝 = add note; chip click) first asks
"Blank workout" or "From template", then offers create, edit of the DSL box, move and duplicate via date fields (non-drag fallback),
skip/unskip, link/unlink an activity (a same-day, same-discipline suggestion is preselected, the user confirms) and
delete. When linked, the template run of the same template name on that activity is shown. Week totals count
completed activities only; planned workouts are counted separately. The week summary also shows **planned time**
("planned 8:00 h") with a progress bar against the done time: summed from each workout's parsed DSL structure (`workoutSummary().durationS`), skipped workouts excluded, linked and missed ones counted;
a trailing `+` / "some durations unknown" marks a partial total (workouts without a structure or with distance-based steps). Same on the own calendar, in athlete (coach) context, and in the compact mobile layout. Not included: running the planned structure's
template on the linked activity (would need the template definition; the snapshot is not a template).

### Workout preview

The planned workout dialog shows a preview chart (`WorkoutPreviewChart`, SVG, theme-aware) rendered live from the DSL box (last valid version kept while the
text has errors) and read-only for existing workouts. Elapsed time x power; blocks coloured by intensity, lighter part = band range, warm-up / cool-down as ramps,
dashed FTP line. %FTP / zone / W bands are scaled with the rider's FTP on the planned day (`ftp_history` of the *rider*, also for a coach); without FTP the axis is %FTP
with a hint. Distance-keyed steps cannot be placed in time: skipped and flagged "partial preview". Not included: W' balance curve (needs CP / W' data that is not readily available)
and day-chip thumbnails. Logic: `src/lib/workoutPreview.js` (tests in `src/lib/__tests__/workoutPreview.test.js`).

## Onboarding / What's new state is always the signed-in user's own
`user_onboarding_state` has no coach policy, and the onboarding provider is disabled in athlete context (`/coach/<id>/...`); see docs/news.md.

## Activity comments (#222)
The active coach may **read and write comments** on the rider's activities, including private ones (the thread is then visible to
owner + coach only), and gets `activity_comment` notifications. Comments are not athlete data: the coach can delete only own comments
(the rider can delete any on their activity), and an ex-coach loses access immediately. The "never writable by a coach" list above is
unchanged. See docs/comments.md.

## Ride type and gears (#279, `20261225000000_ride_type_and_gears.sql`)
The active coach can see and **edit** the athlete's activity `ride_type`, `gears` and `gear_segments` (and `profiles.default_ride_type` with the other training defaults). Coaches still have no UPDATE policy on `activities`: the only write path is the `set_activity_gear` SECURITY DEFINER RPC, which whitelists those three fields, requires an active coaching relationship (a missing or foreign activity id returns the same "Activity not found"), audits via `record_coach_edit` and notifies the rider. The trigger stamps `gear_set_by` / `gear_set_at` / `gear_set_by_coach` from `auth.uid()`; a later rider edit clears `set_by_coach`. UI: "set by coach" badge on the activity page and a coach panel in athlete context. Pending, ended and blocked coaches and strangers are rejected (see `scripts/db-harness/ride-gear-adversarial.mjs`).
