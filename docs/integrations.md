# Activity integrations (Strava, Wahoo, Intervals.icu)

Riders connect a platform once under **Settings → Connections**; new rides then arrive without further action.
Data model details: [data-model.md](data-model.md).

## Connect / disconnect
- **Intervals.icu** (migration `20270112000000_intervals_oauth.sql`): OAuth2 with scopes `ACTIVITY:READ,CALENDAR:WRITE`
  (`ACTIVITY:WRITE` is not needed). `/api/connections/intervals/authorize` returns a URL with the HMAC-signed state (keyed with
  `INTERVALS_CLIENT_SECRET`) and a PKCE S256 challenge; the verifier travels in a short-lived httpOnly cookie. The callback exchanges the
  code (valid 2 minutes) at `POST https://intervals.icu/api/oauth/token`, stores the access token in `connections.access_token`
  (service role only; the token does not expire) and the athlete id from the response, so riders type nothing. API calls use
  `Authorization: Bearer` with athlete id `0`. Disconnect calls `DELETE /api/v1/disconnect-app`. Webhooks (#316) give near-real-time sync, see "Intervals.icu webhooks" below; the 15-minute cron stays the safety net.
  Existing **API-key connections keep working** (athlete id + API key, Basic auth); `connections.auth_method` (`oauth` | `api_key`, non-secret)
  drives the "Reconnect with one click" prompt in Settings. Reconnecting keeps the backfill settings and sync cursor
  (a previously disconnected row resets its backfill via `trg_reset_backfill_on_reconnect`) and drops the legacy API key.
  The API-key form remains available as a fallback.
- **Strava**: OAuth (`activity:read_all`). The authorize endpoint returns a URL with an HMAC-signed, 10-minute state bound
  to the user; the callback stores the tokens server-side with the service role.
- **Wahoo** (Wahoo Cloud, migration `20270110000000_wahoo.sql`): OAuth (`user_read workouts_read workouts_write plans_write offline_data`), same signed state as Strava
  (keyed with `WAHOO_CLIENT_SECRET`). Rides arrive as `.fit` files and are analysed with `analyzeFit`, like Intervals.icu. Access tokens last
  2 h and are refreshed just before an API call (Wahoo revokes the old token only after the new one is used; max 10 live tokens per user). Wahoo's
  list API has no date filter, so the newest-first listing is paged (binary search for the window start). Webhook `workout_summary` events
  (`/api/webhooks/wahoo`, verified by `WAHOO_WEBHOOK_TOKEN`) trigger the rider's sync; the 15-minute pg_cron job `wahoo-sync` is the fallback.
  Wahoo only exposes the rider's own recordings, not third-party workouts. Disconnect calls `DELETE /v1/permissions`.
- **Planned workout upload to Wahoo** (migration `20270111000000_wahoo_planned_push.sql`, same design as the Intervals push above): a planned
  ride/track workout becomes a Wahoo *plan* (`POST /v1/plans`, plan JSON 1.0.0 built by `src/lib/wahooPlan.js`: warm-up/cool-down, repeat blocks,
  `ftp`/watts/rpm/hr/speed targets, FTP from `profiles.ftp_w`) plus a scheduled *workout* (`POST /v1/workouts`, `plan_id`, day at noon UTC) that
  references it. Needs the `plans_write` and `workouts_write` scopes, so riders who connected earlier must reconnect (the API answers 403 and the
  UI says so). Manual push/update/remove from the workout dialog (`/api/planned-workouts/:id/wahoo`), opt-in auto push on the Wahoo card
  (`connections.push_planned_workouts` of the wahoo row, RPC `set_wahoo_push_enabled`) handled by the same 15-minute cron
  (`/api/planned-workouts/push/run` runs the Intervals cycle, then `runWahooPushCycle`). Mapping/status live in `planned_workout_wahoo_pushes`
  (own plan/workout ids, claim, hash, tombstones for deleted workouts); records are found again by `plan[external_id]` = `velocity-stack:<workout id>`
  if a response was lost. Steps Wahoo cannot express (HR %, W/kg, LT1/LT2, zones) are converted with a warning or kept as duration-only steps; workouts
  without steps are scheduled without a plan. Wahoo only shows a plan on the ELEMNT within 6 days before the workout; the portal's deauthorisation
  flags can delete upcoming workouts/plans. Rate limits (200/5 min) surface as `rate_limited`. Gym/other disciplines are not sent.
- **Disconnect** clears all credentials/tokens (Strava access is also deauthorized at Strava) and stops syncing; imported
  rides stay. Revoking the app at Strava is detected via webhook and disconnects automatically.
- Secrets are never selectable by clients (column grants on `connections` expose only non-secret columns).

## Sync cadence
- pg_cron jobs `intervals-sync` and `strava-sync` run every 15 minutes and call `POST {app_base_url}/api/sync/<provider>/run`
  through pg_net with the shared token from `public.sync_settings` (generated in the database, never in the repo).
- Strava additionally pushes webhook events to `/api/webhooks/strava`, which trigger that rider's sync within seconds.
- **Sync now** in the settings card runs the caller's own sync (60 s cooldown).
- Each run is bounded by a 45 s time budget (Intervals.icu imports 4 rides in parallel). A run that ends with history
  left and made progress immediately triggers the next one (max 20 in a chain); the 15-minute cron is the safety net.
- Strava requests share one app-wide budget (200 reads/15 min, 2,000/day, tracked in the database from the response
  headers). History import may use 60% of the 15-minute and 70% of the daily budget; the rest is reserved for live rides
  (webhook/new rides), which are always synced first. Backfills are shared fairly between riders. When the budget is
  spent, runs stop quietly and resume after the window resets (:00/:15/:30/:45, daily at midnight UTC).

## Strava analysis and repair
- Strava has no .fit export, so rides are analysed from streams (`analyzeStreams`) into the same `{ summary, curves, time_series }`
  shape as the .fit path (`api/analyze.py`), including `time_series.heartrate` and the `HeartRate` curve.
- If saving `activity_curves` fails, the import is rolled back and reported as failed (retried on the next run) instead of
  leaving a ride without curves.
- Each Strava sync run also repairs earlier imports: rides without `activity_curves` rows get them rebuilt from the stored
  `curves_data` (no Strava request); rides without `time_series.heartrate` are re-fetched and re-analysed (max 3 per run,
  from the shared backfill budget). Intervals.icu rides are never touched.

## Failures and health
Each card shows a health line (Syncing normally / Sync looks delayed after 60 min / Sync stopped) and the last error.
- Invalid Intervals.icu key, revoked or invalid Strava grant: status `error`, automatic sync stops; use **Reconnect**.
- Strava rate limit or other transient errors: shown as "Last sync issue", retried automatically.
- Not configured on this deployment (missing env vars): the Strava card says so; the run endpoints answer 503.

## De-duplication and priority
- Same external id from the same provider is imported once (unique index).
- A ride matching an existing one (same user, start time and duration within 5 s, or same `.fit` hash) is not imported again.
- Priority Intervals.icu = Wahoo > Strava (a tie keeps the first copy; a Wahoo copy replaces a Strava copy): when both deliver a ride, the Intervals.icu copy is kept (it replaces a Strava copy).
  Manual uploads and bot rides are never replaced or deleted by an import.
- Deleting a ride on Strava does not delete it in the app.

## Backfill
Per connection: last 30 days (default), 90 days, 1 year or full history (`backfill_days` NULL). History is imported
**newest to oldest** so recent rides appear first; the card shows "Importing history, newest first: X of Y rides".
Changing the window restarts the backfill (rides already imported are skipped). New rides keep syncing during a backfill.
Strava lists rides with `before` only (never `after`, which Strava answers oldest-first) and applies the window's
lower bound client-side; the backfill cursor is the oldest start date on the page, so no order is assumed and the
backfill is only complete once a listing reaches the window start. Connections that finished a backfill with the old
(gapped) listing were re-opened once by migration `20261224000000_reopen_strava_backfill.sql`.
Strava costs about one read per ride (list item data is reused; only the streams endpoint is called per ride).

## Configuration (hosting env settings, never committed)
| Variable | Purpose |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Required for background sync, the Strava callback and webhook. Without it the run endpoints return 503. |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | Strava API app (https://www.strava.com/settings/api). The secret also signs the OAuth state. |

| `INTERVALS_CLIENT_ID`, `INTERVALS_CLIENT_SECRET` | Intervals.icu OAuth app (not a public client; PKCE S256 is sent, "Require PKCE" not yet enabled). The secret also signs the OAuth state. Redirect URI `https://www.velocity-stack.app/api/connections/intervals/callback` (exact match). Without them the API-key form is the only option. |
| `INTERVALS_WEBHOOK_TOKEN` | Shared secret for `/api/webhooks/intervals`; set the same value as the app's *Webhook Authorization Header* on Intervals.icu. Without it the endpoint answers 503. |
| `WAHOO_CLIENT_ID`, `WAHOO_CLIENT_SECRET`, `WAHOO_WEBHOOK_TOKEN` | Wahoo API app. The secret also signs the OAuth state; the webhook token authenticates events. Redirect URI `https://www.velocity-stack.app/api/connections/wahoo/callback`, webhook `https://www.velocity-stack.app/api/webhooks/wahoo`. |

Strava app settings: **Authorization Callback Domain** = `www.velocity-stack.app` (the canonical host; the apex `velocity-stack.app` 308-redirects to it).
The OAuth `redirect_uri` is built from the request host (`src/lib/server/appUrl.js`), so riders should connect via the canonical host. Reaching the app via the `vercel.app` alias still works, but Strava rejects the callback there because the domain does not match.
The webhook subscription (one per Strava app, callback `{app_base_url}/api/webhooks/strava`) is created automatically when
the first rider connects, or manually with `POST /api/webhooks/strava/subscribe` while signed in. The verify token and
the cron token live in `public.sync_settings`; `app_base_url` there decides where pg_cron calls.

## Intervals.icu webhooks (#316)
Configured once on the Intervals.icu *Manage App* page: URL `https://www.velocity-stack.app/api/webhooks/intervals`, the secret from
`INTERVALS_WEBHOOK_TOKEN`, and the types `ACTIVITY_UPLOADED`, `ACTIVITY_UPDATED`, `ACTIVITY_DELETED`, `CALENDAR_UPDATED`, `APP_SCOPE_CHANGED`
(not the legacy `CALENDAR_EVENT_*`). No migration or database secret is needed.
- **Payload**: `{ "secret": "...", "events": [{ "athlete_id": "...", "type": "...", "timestamp": "...", ... }] }`; one POST can carry several
  events. Authenticity: the body `secret` (as documented in the Intervals.icu API cookbook) or an `Authorization` header (raw or `Bearer`)
  must equal `INTERVALS_WEBHOOK_TOKEN` (constant-time); otherwise 403. Activity webhooks are not delivered for Strava-sourced rides.
- **Mapping**: `athlete_id` -> non-disconnected Intervals `connections` row (`external_athlete_id`, with or without the `i` prefix).
- **Events**: `ACTIVITY_*` make the rider's connection due and trigger `/api/sync/intervals/run` for that user (nothing from the payload is
  imported directly). `ACTIVITY_DELETED` only triggers a sync: imported rides are never deleted. `CALENDAR_UPDATED` makes the rider due for
  the planned push cycle (only when auto push is on; echoes of our own `velocity-stack:` events are skipped). `APP_SCOPE_CHANGED` sets an
  OAuth connection to `error` with a "Reconnect" message unless the payload still lists an `ACTIVITY:` scope.
- **Reliability**: the endpoint answers 200 quickly (errors are logged, the cron catches up); repeated deliveries are harmless because
  imports are de-duplicated and triggers only mark the rider due.

## Planned workouts -> Intervals.icu (`20261208000000_planned_workout_intervals_push.sql`)
A planned workout can be sent to the rider's Intervals.icu calendar as an event (`POST/PUT/DELETE /api/v1/athlete/{id}/events`,
category `WORKOUT`, type Ride/WeightTraining/Workout, name, `start_date_local` at `T00:00:00`, description in Intervals.icu workout
syntax, `external_id = velocity-stack:<planned workout id>`).

- **Converter**: `src/lib/intervalsWorkout.js` (pure; `buildIntervalsEvent`, `plannedPushHash`, `pushState`). Warm-up/cool-down are
  duration-only steps, repeats are `Main set Nx` blocks, sets are expanded (no nested repeats), `%FTP`/W/`% HR`/`% LTHR`/rpm bands are
  sent as targets (single-sided bands use their bound), `%LT2` is sent as %FTP, `%LT1` as 75% FTP, power zones as %FTP of the default zone
  model (custom zones are not applied). Best-effort, bpm, `%LT1HR`, km/h and W/kg bands have no target: the step keeps its duration and the
  target is written as a note. Distance steps need a km/h band (duration = distance / mid speed), otherwise they are left out with a note.
  Fixed track patterns have no steps and become a plain-text description. Every degradation is returned as a warning and shown in the app.
- **Who / how**: `POST|DELETE /api/planned-workouts/<id>/intervals`. The request-scoped (RLS) client must see the workout (rider or ACTIVE,
  non-blocked coach); only then the athlete's connection is loaded with the service role. 503 without `SUPABASE_SERVICE_ROLE_KEY`.
  The key and athlete id never leave the server (not in responses, errors or logs).
- **Connection check**: only an `active` Intervals connection can push; otherwise the app shows a link to Settings -> Connections.
  401 (bad key) and 403 (read-only key) stop the push with an actionable message; network errors, 429 and 5xx are retried later.
- **Mapping**: `planned_workout_pushes` (service-role writes, rider/active coach read): `intervals_event_id`, `pushed_hash`, `push_status`
  (`pending|pushed|error|pending_delete`), `last_error`, `warnings`. A workout is *out of date* when its hash differs from `pushed_hash`.
  Only events whose id we stored (or that carry our `external_id`) are updated or deleted; an event with a foreign `external_id` is never deleted.
  If the event was deleted in Intervals.icu (404 on update) it is recreated (the plan in Velocity Stack wins).
- **Scheduled push**: `planned-workout-push` (pg_cron every 15 min -> pg_net -> `/api/planned-workouts/push/run`, `x-sync-token`, like
  `intervals-sync`; no external secrets). Riders opt in with `connections.push_planned_workouts` (default OFF, toggle in Settings ->
  Connections). It pushes new/changed planned workouts from today to +60 days (max 25 per rider, 10 riders and 45 s per run), removes
  skipped workouts, and always propagates deletions (tombstones) for riders with an active connection. A failing workout is retried
  after 6 h unless edited; a 401/403 stops that rider and is shown in Settings. Disconnecting or switching the Intervals athlete turns the
  setting off and forgets the mappings (existing events stay in Intervals.icu).
- Not included: `.fit` / `.zwo` export, W/kg targets (no rider weight is sent), live verification against Intervals.icu with a real key.

## Tests
CI runs `npm test` (`.github/workflows/test.yml`).
