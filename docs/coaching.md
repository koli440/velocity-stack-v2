# Coaching (step 2: relationships, consent, read access)

- Any account can coach; no flag. Either side initiates (coach: *Invite as athlete*, rider: *Request as my coach*);
  the rider's acceptance (or own request) is the consent. Self-coaching and blocked pairs are refused. Bots are allowed (see *Coaching with bots*).
- A rider has at most one active coach. Accepting a new coach's invite swaps atomically (advisory lock + unique
  index); the UI warns first, naming the coach being replaced, and that coach gets a `coach_replaced` notification.
  `request_coach` is refused while the rider already has a coach, so a coach's acceptance never replaces one.
- Access has no expiry. The rider revokes, or the coach leaves (`end_coaching`); a block ends it.
- Declines are silent (declined rows look "pending" to the requester, 30-day re-request cooldown, max 25 pending per user).

## Privacy rules
- Coaches read everything of the athlete, including private activities, curves, templates, PBs and histories.
- Activities are read only via `shared_activities`: privacy-zone coordinates stay masked exactly as for other riders;
  raw GPS and `raw_file_url` never leave the owner-only `activities` table.
- Never exposed: connection tokens, `profile_secrets`, email. `get_athlete_profile` returns training fields only.
- Known gap: `shared_activities` does not expose later snapshot columns (e.g. `ftp_at_activity_w`).

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


## Planned workouts (step 4b, `20261206000000_planned_workouts.sql`)

Single workouts planned on a rider's calendar (no recurrence, no multi-week plans yet).
- **Who**: the rider and the rider's ACTIVE coach (`is_coach_of`, block-aware, per statement -> revocation is immediate) can read, plan, edit, move, skip, link/unlink and delete
  ANY planned workout on that calendar (each other's too). Pending / declined / ended / blocked coaches, other riders' coaches, followers and strangers get nothing.
  Never in the feed, public profile or any follower-visible view. No notification, not in realtime.
- **Definition**: date + discipline (`ride|track|gym|other`) + title + optional notes + an optional **snapshot** of a template's structure (DSL source + manifest), taken
  server-side when planned (`planned_workout_create` / `planned_workout_set_template`). It is a copy, not a live reference: later edits of the template do not change it.
  Allowed sources: the **caller's own** and system templates (a coach cannot snapshot the rider's templates, the rider cannot use the coach's). The coach's template row
  and metadata are never exposed - only the snapshot and the template *name*; the rider sees the full structure of workouts planned for them.
- **Stamps**: `created_by` / `updated_by` / `set_by_coach` come from `auth.uid()` in a trigger; clients cannot name those columns. Label: "planned by coach <name>",
  "planned by former coach" when the account is gone. Workouts survive the end of coaching and coach account deletion (FKs `SET NULL`).
- **Status**: `planned | skipped` stored; completed = linked to an activity; **missed** = past + unlinked + not skipped, derived in the UI.
- **Linking**: the app only *suggests* a match (`suggestMatches`: same day + discipline, one-to-one); a rider or coach confirms or links/unlinks manually
  (`planned_workout_link` / `_unlink`). The activity must belong to the same rider; an activity completes at most one workout and a workout has at most one activity (unique index).
  Deleting the activity only clears the link. Linking clears "skipped".
- **Limits**: title 80, notes 2000, DSL 4000 chars, manifest 20 kB, 20 workouts per rider and day.
- Pure logic and data helpers: `src/lib/plannedWorkouts.js` (tests in `src/lib/__tests__/plannedWorkouts.test.js`).

### Planned workouts UI

`ActivityCalendar` (used by `/calendar` and `/coach/<riderId>/calendar`) fetches the visible grid range of planned
workouts next to activities and notes. Chips are styled per status (planned dashed blue, completed green, skipped
struck through, missed red) and can be dragged to another day; `PlannedWorkoutDialog` (🗓 button / chip click) offers
create, edit, structure from a template (own + system only), move and duplicate via date fields (non-drag fallback),
skip/unskip, link/unlink an activity (a same-day, same-discipline suggestion is preselected, the user confirms) and
delete. When linked, the template run of the same template name on that activity is shown. Week totals count
completed activities only; planned workouts are counted separately. Not included: running the planned structure's
template on the linked activity (would need the template definition; the snapshot is not a template).
