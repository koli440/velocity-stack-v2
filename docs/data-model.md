# Rider data model

| Layer | Contents | Who can read |
|-------|----------|--------------|
| `auth.users` | Credentials only (email, password, metadata used once at signup) | Auth service |
| `public.profiles` | Identity (`first_name`, `last_name`, `nickname`), training defaults, `theme_preference`, privacy zone, `require_follow_approval`, `discoverable_by_email`, `avatar_url`, `is_bot`, `bot_persona` | Own row only (RLS); legacy, kept for backward compatibility (see Connections) |
| `public.profile_secrets` | `intervals_athlete_id`, `intervals_api_key` | Own row only (RLS) |
| `public.public_profiles` (view) | `id, display_name, nickname, first_name, last_name, require_follow_approval, is_bot, avatar_url` (blocked riders filtered out) | Authenticated riders |
| `search_riders` / `get_rider_profile` (SECURITY DEFINER RPCs) | Ranked search and profile with follow state, ride counts, last ride | Authenticated riders |

## Profile image
`profiles.avatar_url` holds the public URL of the rider's image in the public `avatars` storage bucket
(`<user_id>/avatar-<timestamp>.<ext>`; max 10 MB, JPEG/PNG/WebP, enforced by the bucket; limit raised from 2 MB by `20261023000000_avatar_size_limit.sql`). Storage RLS lets
a rider insert/replace/delete only objects under their own `<user_id>/` prefix, and a CHECK constraint only
accepts URLs pointing at that folder. Images are uploaded as-is and cropped with CSS (`Avatar` component,
square + `object-cover` + rounded); without an image an initials placeholder is shown. `avatar_url` is
returned by `public_profiles`, `search_riders` and `get_rider_profile`. Migration `20261022000000_profile_images.sql`.

## Display name
`display_name = nickname`, else `first_name + last_name`, else `'Rider'`.
Users without any name were backfilled with their e-mail local-part as nickname.

## Signup
A trigger on `auth.users` (`handle_new_user`) creates the profile from `options.data`
(`first_name`, `last_name`) so a signup can never leave an account without a profile.
The register page no longer upserts the profile itself.

## Search
Nickname / first / last name: trigram match. E-mail: **exact, case-insensitive, full address only**,
evaluated inside the RPC against `auth.users`; the e-mail is never returned, at most one result,
blocks respected.

### Privacy decision (please review)
Exact e-mail search lets a signed-in user confirm whether an address has an account (enumeration).
Mitigations: exact match only, one result, no e-mail in output, and the opt-out
`profiles.discoverable_by_email` (default `true`, toggle in profile settings).
Consider rate limiting at the API gateway if abuse appears.
Backfilling nicknames from e-mail local-parts makes that part publicly visible as a display name.

## Migration
`20261020000000_profile_model.sql` backfills names (metadata, `full_name` split, e-mail local-part)
and copies `intervals_*` into `profile_secrets` **before** dropping the old columns; it is idempotent.

## Activity provenance and duplicates
`20261025000000_activity_sources.sql` adds to `public.activities`: `source` (`manual`|`intervals`|`strava`|`bot`,
default `manual`), `external_source` and `external_id` (platform activity id; both set or both null).
`uq_activities_user_external` is a unique partial index on `(user_id, external_source, external_id)` where
`external_id IS NOT NULL`. The `BEFORE INSERT` trigger `guard_activity_duplicate()` rejects (SQLSTATE `23505`) a new
activity whose `file_sha256` matches, or whose `start_time` and `elapsed_time_s` are both within 5s, of an existing
activity of the same user - unless the new source outranks an existing **Strava** copy (`activity_source_priority()`:
intervals 3 > strava 2 > other 1), so an Intervals.icu import can replace a Strava copy. Manual and bot activities are
never replaced (deleting them would cascade to kudos/comments/photos), so a matching import is skipped instead.
`20261029000000_activity_guard_replace_strava_only.sql` tightened the guard to this rule (the first version let imports
outrank manual rows). Existing rows are never checked.
Client mirror: `sourcePriority` / `resolveDuplicate` in `src/lib/activityDuplicates.js`.

## Server-side activity import
Both the Intervals.icu modal and (later) background sync share one pipeline, `importActivity()` in
`src/lib/server/importActivity.js`: provider adapter fetch -> analyze (`.fit` via `/api/analyze`, else
`analyzeStreams()` in `src/lib/streamAnalysis.js`) -> `planImport()` (same external id => skip; duplicate =>
`resolveDuplicate`: `upgrade` inserts the new copy then deletes the Strava copy it outranks, `skip` inserts nothing) ->
insert `activities` + `activity_curves`. `POST /api/sync/intervals` (`action: 'list' | 'import'`) validates the
Supabase bearer token (`getRequestUser`), reads credentials from the caller's own `profile_secrets` row (never from
the request body) and returns `409 { duplicate: true }` for a skipped duplicate, else
`{ success, status: 'imported'|'upgraded', activityId, replacedId }`.

Provider adapter contract: `{ source, fetchActivity(externalId, { gearing, analyzeFit }) -> { title, startDateLocal,
summary, curves, time_series } }` (see `src/lib/server/intervalsProvider.js`). Env vars for future steps (hosting
settings only, never committed): see `.env.example`.

## Connections (`20261026000000_connections.sql`)
`public.connections` (unique `(user_id, provider)`, provider `intervals`|`strava`): `external_athlete_id`, secrets
`api_key` (Intervals), `access_token`/`refresh_token`/`token_expires_at` (Strava), `status`
(`active`|`error`|`disconnected`), `last_error`, `last_synced_at`, `backfill_days` (default 30, NULL = full history),
`created_at`, `updated_at`. RLS: own rows; clients have `SELECT` only on the non-secret columns (column grants), so
secrets are readable only with the service role. Existing `profile_secrets` Intervals credentials are copied in
idempotently (`profile_secrets` is not dropped; the sync route falls back to it when `SUPABASE_SERVICE_ROLE_KEY` is
not configured, and `POST /api/connections/intervals` then mirrors the key there).

Own-row `SECURITY DEFINER` functions (execute for `authenticated`): `connect_intervals(p_athlete_id, p_api_key,
p_backfill_days default 30)`, `disconnect_connection(p_provider)` (clears all secrets, status `disconnected`; also clears
legacy `profile_secrets` Intervals fields), `set_connection_backfill(p_provider, p_backfill_days)`,
`record_connection_result(p_provider, p_error default null)` (null = success: status `active`, `last_synced_at = now()`).

API: `POST|PATCH|DELETE /api/connections/intervals` (connect after validating against Intervals.icu / set backfill /
disconnect). `/api/sync/intervals` `list` uses `backfill_days` (`backfillOldest()` in `src/lib/connections.js`).
Server helper: `loadIntervalsConnection({ supabase, userId }) -> { athleteId, apiKey, backfillDays, status, source }`
in `src/lib/server/connections.js`; `getServiceClient()` returns null without `SUPABASE_SERVICE_ROLE_KEY`.

## Automatic Intervals.icu sync (`20261027000000_intervals_auto_sync.sql`)
- `public.sync_settings(key, value, updated_at)` — service-role-only (RLS on, no client grants). Rows: `cron_token`
  (random, generated in the migration, never in the repo) and `app_base_url` (`https://www.velocity-stack.app`, set by `20261030000000_app_base_url_canonical_host.sql`;
  edit the row to repoint; if empty/missing the cron job is a no-op).
- `connections.last_attempt_at` — claim/ordering column for sync runs (not exposed to clients).
- `sync_trigger_intervals()` (SECURITY DEFINER, not executable by clients): if an active Intervals connection exists,
  `net.http_post` (pg_net) to `{app_base_url}/api/sync/intervals/run` with header `x-sync-token: <cron_token>`.
  pg_cron job `intervals-sync`, `*/15 * * * *`.
- `record_connection_result_for(p_user_id, p_provider, p_error default null, p_fatal default false,
  p_synced_at default null)` — service_role only. Success clears the error; `p_fatal` sets status `error` (cron then
  skips it until the user reconnects or runs a manual sync); non-fatal only records `last_error`; `p_synced_at` moves the
  cursor. Reusable for Strava (`p_provider = 'strava'`).
- `set_connection_backfill` resets the backfill state (see "Newest-first backfill") and `last_attempt_at`; it no longer
  touches the forward cursor `last_synced_at`.

Endpoint `POST /api/sync/intervals/run` (`maxDuration` 60 s, needs `SUPABASE_SERVICE_ROLE_KEY`, 503 otherwise):
- cron mode: header `x-sync-token` verified against `sync_settings.cron_token`; processes up to 10 active connections not
  attempted in the last 10 min, least recently attempted first.
- manual mode: `Authorization: Bearer <user token>`; syncs only the caller's connection, 429 within 60 s of the last attempt.
- Per connection (`src/lib/server/intervalsSync.js`): a forward phase lists rides since `last_synced_at` minus 2 days and
  imports them; then a backfill phase imports history newest to oldest (see "Newest-first backfill"). Rides already
  imported are dropped by external id, imports go through `importActivity` (duplicates skipped, Strava copies upgraded,
  unique violation 23505 = skipped); Intervals.icu imports 4 rides in parallel, the cap is the 45 s deadline, not a fixed
  count. 401/403/404 => status
  `error` with a message; other failures keep the status and only set `last_error`. One failing connection or ride never
  blocks others. Pure logic: `src/lib/syncPlan.js`.

## Newest-first backfill and Strava budget (`20261110000000_backfill_cursor_strava_budget.sql`)
- `connections.last_synced_at` is only the **forward** cursor (ongoing new rides; set to the run start when the forward
  phase finished). History uses separate, client-readable columns: `backfill_cursor` (TIMESTAMPTZ; everything newer than it
  inside the window is handled, NULL = start at the newest ride), `backfill_complete` (BOOLEAN, default false),
  `backfill_imported` (INT) and `backfill_total` (INT, known for Intervals.icu; NULL for Strava).
  Existing rows with `last_synced_at` are marked `backfill_complete = true` (the old oldest-first cursor already covered
  history; the forward sync catches the rest).
- Forward sync always runs first, so new rides never wait for an old backfill. The backfill lists the window
  `[backfillOldest(backfill_days), cursor]` (Intervals.icu: one list sorted newest-first; Strava: paginated newest-first
  with `before`), imports newest-first and moves the cursor backwards. Known rides are skipped, so overlaps are harmless.
- `set_connection_backfill` and reconnecting (trigger `trg_reset_backfill_on_reconnect`) reset cursor/complete/counters;
  already imported rides are skipped by external id, so nothing is imported twice and a longer window extends the history.
- `record_backfill_progress(p_user_id, p_provider, p_backfill_days, p_cursor, p_complete, p_imported_delta, p_total)` —
  service_role only; ignored if `backfill_days` changed meanwhile.
- `strava_rate_budget` — single row (id = 1), RLS on, no client grants. App-wide Strava usage from the
  `X-ReadRateLimit-*`/`X-RateLimit-*` headers: 15-minute and daily counters (read and overall) with limits (defaults
  200/2000 and 400/4000). `record_strava_rate_usage(...)` (service_role only) merges observations inside the current window
  (15-min windows at :00/:15/:30/:45, daily at 00:00 UTC) and resets counters when the window rolled over.
- Budget rules (`src/lib/stravaBudget.js`): backfill may use at most 60% of the 15-minute and 70% of the daily read limit;
  the remainder is reserved for live (webhook/new-ride/forward) sync. Every Strava run checks the budget first and stops
  cleanly (no error) when exhausted. Strava backfills are round-robin (least recently attempted first) with an equal share
  of the remaining backfill budget per rider (max 10 rides per turn).
- Chaining: a run that ended with work left and progress made triggers the next run immediately (cron token, fire and
  forget, `{ "chain": n }` body, max depth 20, 3 s minimum gap); Strava stops chaining when the backfill budget is spent.
  The 15-minute cron stays the safety net.

## Strava (`20261028000000_strava.sql`, #109 step 5)
- `sync_settings.strava_webhook_verify_token` — random, generated by the migration (service-role only, never in the repo);
  echoed to Strava when it validates the webhook subscription (`GET /api/webhooks/strava`).
- `sync_trigger_strava()` + pg_cron job `strava-sync` (`*/15 * * * *`): fallback polling, `POST {app_base_url}/api/sync/strava/run`
  with the shared `cron_token` (no-op without active Strava connections). `/api/sync/intervals/run` and `/api/sync/strava/run`
  share `src/lib/server/syncRoute.js` (cron mode may take `{ "userId": ... }` to sync a single rider; manual mode = caller).
- Strava `connections` rows use `external_athlete_id` (Strava athlete id), `access_token`, `refresh_token`,
  `token_expires_at`; tokens are refreshed 5 min before expiry (`getFreshAccessToken`) and persisted. Revoked/invalid
  grants or a 401 set status `error` (UI asks to reconnect); HTTP 429 or nearly exhausted `X-RateLimit-*` budgets stop the
  run non-fatally and resume on the next one.
- OAuth: `GET /api/connections/strava/authorize` (Bearer auth; returns `{ url }`, scope `activity:read_all`, HMAC-signed
  state bound to the user, 10 min expiry, keyed with `STRAVA_CLIENT_SECRET`) and `GET /api/connections/strava/callback`
  (verifies state, exchanges the code, upserts the connection with the service client, redirects to `/settings?strava=<flag>`).
  `GET|PATCH|DELETE /api/connections/strava`: configured flag / backfill / disconnect (best-effort Strava deauthorization).
- Adapter `src/lib/server/stravaProvider.js` (`source: 'strava'`): lists Ride/VirtualRide/... activities since a date
  (paginated), uses the list item (name, start_date(_local), elapsed/moving time; the import needs nothing else from the detail endpoint) and fetches only streams (no .fit); the detail endpoint is called only as a fallback for ids not seen in a list which are resampled to 1 Hz and analysed by `analyzeStreams`;
  `start_time`/`elapsed_time_s` come from the Strava activity so duplicate detection works. Pure helpers: `src/lib/strava.js`.
- Webhook `POST /api/webhooks/strava` (`src/lib/server/stravaWebhook.js`): activity create/update for a known athlete resets
  `last_attempt_at` and triggers that rider's sync (delete events are ignored); `athlete` events with
  `authorized=false` are verified against Strava before the connection's tokens are cleared (status `disconnected`).
  Webhook subscription: created automatically on the first rider connect, or `POST /api/webhooks/strava/subscribe`
  (signed in, or `x-sync-token`); idempotent (Strava allows one subscription per app).
- Priority: Intervals.icu (3) > Strava (2) > manual (1), but only Strava copies are ever replaced. Strava arriving after
  Intervals (or after a manual upload) is dropped before fetching (`selectNewRides`) or skipped by the DB guard; Intervals
  arriving after Strava replaces the Strava copy (`upgraded`).

See [integrations.md](integrations.md) for the user-facing flow, env vars and setup.

## Calendar (`/calendar`)

Month calendar of a rider's activities (Monday-start weeks). Each week row ends with a prominent summary card (time, distance, count); on mobile it is a bar under the week.
`ActivityCalendar` takes an optional `riderId` (defaults to the signed-in user) and a `fetchEvents` function, so a
coach view can reuse it later. Only the visible range is queried (`activity_date >= start AND < end`) with a minimal
column list; days are bucketed in the browser's local time. Day cells hold generic events (`kind: 'activity' | 'planned'`)
so planned workouts can be added alongside activities. Pure logic lives in `src/lib/calendar.js`. Day cells also carry calendar notes (see below).

## Coaching (`20261129000000_coaching_relationships.sql`)

`coaching_relationships(id, coach_id, rider_id, status pending|active|declined|ended, initiated_by, created_at, responded_at, ended_at, ended_by)`.
RLS is on and clients hold no table privileges; all reads/writes go through SECURITY DEFINER RPCs
(`invite_athlete`, `request_coach`, `accept_coaching`, `decline_coaching`, `end_coaching`, `my_coaching`,
`coaching_status_with`, `get_athlete_profile`). One active coach per rider (partial unique index).
`is_coach_of(rider)` is block-aware and drives extra SELECT policies on activity curves, template runs/templates,
PBs, aero tests, ftp/weight/lactate/power-zone history, and the `shared_activities` view / `can_view_activity`
(photos). The base `activities` table stays owner-only; coaches read the masked view. See [coaching.md](coaching.md).

## Coach edits (`20261130000000_coach_edits.sql`)

- History tables (`ftp_history`, `weight_history`, `lactate_threshold_history`, `power_zone_history`) gain
  `changed_by UUID`, `changed_at TIMESTAMPTZ`, `set_by_coach BOOLEAN` (trigger `stamp_history_row`, always computed from
  `auth.uid()`); `profiles` gains `training_set_by`, `training_set_at`, `training_set_by_coach` (trigger
  `stamp_profile_training`, set only when a training default changes).
- Coach write policies `*_insert_coach/_update_coach/_delete_coach` on those four tables (`is_coach_of(user_id)`).
  `coach_update_athlete_profile(p_rider, p_changes)` is the only coach write path to `profiles` (whitelist of four fields).
- `coach_edits(id, rider_id, coach_id, table_name, row_id, action, old_values, new_values, created_at)`: audit trail
  written by triggers (`audit_history_row`, `record_coach_edit`); SELECT for the rider and (while active) the coach.
- `notifications.type` gains `coach_edited` (max one unread per user/actor, `uq_notifications_coach_edited_unread`).
- `get_athlete_profile` now also returns the training stamp; `coach_dashboard()` lists active athletes with last activity
  and 7-day volume.

`template_executions` also has `by_coach`, `run_by_coach_id`, `coach_key` (uniqueness with activity+template) and name/slug/category
snapshot columns; see *Coach template runs* in coaching.md.

## Calendar notes (`20261205000000_calendar_notes.sql`)

`calendar_notes(id, rider_id -> profiles ON DELETE CASCADE, note_date DATE, title TEXT 1-80, body TEXT <= 1000, created_by / updated_by -> profiles ON DELETE SET NULL,
set_by_coach BOOLEAN, created_at, updated_at)`, index `(rider_id, note_date)`. RLS: SELECT/INSERT/UPDATE/DELETE for `rider_id = auth.uid()` or `is_coach_of(rider_id)`.
Client grants are column-level (INSERT: rider_id, note_date, title, body; UPDATE: note_date, title, body); trigger `calendar_notes_stamp` trims text, stamps
`created_by` / `updated_by` / `set_by_coach` / timestamps from `auth.uid()`, pins `rider_id`, and caps 20 notes per rider and day. Notes survive the end of coaching and the deletion of the
coach account (FK `SET NULL`). See *Calendar notes* in coaching.md.



## Calendar races (`20261210000000_calendar_races.sql`)

`calendar_races(id, rider_id -> profiles ON DELETE CASCADE, race_date DATE, race_time TIME NULL, name TEXT 1-80, discipline TEXT ride|track|other, priority TEXT A|B|C,
location TEXT <= 120, format_note TEXT <= 200, notes TEXT <= 1000, activity_id -> activities ON DELETE SET NULL, created_by / updated_by -> profiles ON DELETE SET NULL,
set_by_coach BOOLEAN, created_at, updated_at)`, index `(rider_id, race_date)`, unique partial index on `activity_id`. RLS for `rider_id = auth.uid()` or `is_coach_of(rider_id)`
(SELECT/INSERT/UPDATE/DELETE). Client grants are column-level (INSERT: rider_id, race_date, race_time, name, discipline, priority, location, format_note, notes, activity_id;
UPDATE: the same without rider_id). SECURITY DEFINER trigger `calendar_races_stamp` trims text, verifies the activity belongs to the race's rider, stamps authors / timestamps
from `auth.uid()`, pins `rider_id` and caps 10 races per rider and day. See *Calendar races* in coaching.md.

## Planned workouts (`20261206000000_planned_workouts.sql`)

`planned_workouts(id, rider_id -> profiles ON DELETE CASCADE, workout_date DATE, discipline ride|track|gym|other, title 1-80, description <= 2000,
structure_dsl TEXT <= 4000, structure_manifest JSONB <= 20 kB, source_template_name TEXT, status planned|skipped, activity_id -> activities ON DELETE SET NULL (unique where not null),
created_by / updated_by -> profiles ON DELETE SET NULL, set_by_coach, created_at, updated_at)`, index `(rider_id, workout_date)`.
- The structure is a **snapshot copy** of a template's `dsl_source` + `manifest` (no template id / FK; only the template name for display).
- RLS: SELECT/UPDATE/DELETE for `rider_id = auth.uid()` or `is_coach_of(rider_id)`; there is **no INSERT policy** (creation is via RPC only).
  Client UPDATE grant: `workout_date, discipline, title, description, status`. Structure, link and stamps cannot be named by clients.
- Trigger `planned_workouts_stamp` stamps `created_by` / `updated_by` / `set_by_coach` from `auth.uid()`, pins `rider_id`, trims text, caps 20 workouts per rider and day,
  and verifies that a linked activity belongs to the same rider. CHECK: a linked workout is never `skipped`.
- SECURITY DEFINER RPCs (pinned `search_path`, `auth.uid()` + `is_coach_of` checked, not executable by `anon`): `planned_workout_create(rider, date, discipline, title, description, dsl, manifest, template_name)`,
  `planned_workout_set_structure(id, dsl|NULL, manifest|NULL, template_name)` (migration `20261207000000`; no table reads of `analysis_templates`), `planned_workout_duplicate(id, date)`, `planned_workout_link(id, activity)`, `planned_workout_unlink(id)`.
  A template is snapshotted server-side from the **caller's own or a system** template only.
- Status shown in the UI: completed (linked) / skipped / missed (derived: past, unlinked, not skipped; never stored) / planned. See *Planned workouts* in coaching.md.

## Intervals.icu push (`20261208000000_planned_workout_intervals_push.sql`)
- `planned_workout_pushes(workout_id PK (no FK: tombstones outlive the workout), rider_id -> profiles ON DELETE CASCADE, intervals_event_id, pushed_hash,
  pushed_at, pushed_date, push_status pending|pushed|error|pending_delete, attempted_hash, last_error, last_attempt_at, claimed_until, warnings JSONB)`.
  RLS: select for the rider / active coach (never `pending_delete`); no client writes (service_role only).
- Trigger `planned_workouts_push_tombstone` (AFTER DELETE): a pushed workout leaves a `pending_delete` row, a never-pushed one leaves nothing.
- `connections` gains non-secret `push_planned_workouts` (default FALSE), `planned_push_attempt_at`, `planned_push_at`, `planned_push_error`
  (SELECT granted to authenticated; written by `set_planned_push_enabled(bool)` / the service role). Trigger `connections_reset_planned_push`
  clears the flag and the rider's mappings on disconnect or athlete change.
- RPC `planned_push_context(p_rider)` -> `{connected, auto_enabled, is_self}` for the rider / active coach. Cron `planned-workout-push` via `sync_trigger_planned_push()`.

## Onboarding and news state (`20261211000000_user_onboarding_state.sql`)
`user_onboarding_state(user_id PK -> profiles ON DELETE CASCADE, welcome_seen_at, onboarding_dismissed_at, news_seen_through TEXT, created_at, updated_at)`. Own-row SELECT/UPDATE
RLS only (no coach/admin read, no client INSERT/DELETE); column-level UPDATE grant; trigger keeps `news_seen_through` monotonic. Created by a trigger on `profiles` or
`ensure_my_onboarding_state()`; existing accounts are backfilled as onboarding done and news seen up to the migration date. See docs/news.md.
