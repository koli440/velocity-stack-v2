# Activity integrations (Strava, Intervals.icu)

Riders connect a platform once under **Settings → Connections**; new rides then arrive without further action.
Data model details: [data-model.md](data-model.md).

## Connect / disconnect
- **Intervals.icu**: athlete id + API key (validated against Intervals.icu, stored write-only in `public.connections`).
- **Strava**: OAuth (`activity:read_all`). The authorize endpoint returns a URL with an HMAC-signed, 10-minute state bound
  to the user; the callback stores the tokens server-side with the service role.
- **Disconnect** clears all credentials/tokens (Strava access is also deauthorized at Strava) and stops syncing; imported
  rides stay. Revoking the app at Strava is detected via webhook and disconnects automatically.
- Secrets are never selectable by clients (column grants on `connections` expose only non-secret columns).

## Sync cadence
- pg_cron jobs `intervals-sync` and `strava-sync` run every 15 minutes and call `POST {app_base_url}/api/sync/<provider>/run`
  through pg_net with the shared token from `public.sync_settings` (generated in the database, never in the repo).
- Strava additionally pushes webhook events to `/api/webhooks/strava`, which trigger that rider's sync within seconds.
- **Sync now** in the settings card runs the caller's own sync (60 s cooldown).
- Each run is bounded (8 ride fetches per connection, 45 s); unfinished work resumes on the next run.

## Failures and health
Each card shows a health line (Syncing normally / Sync looks delayed after 60 min / Sync stopped) and the last error.
- Invalid Intervals.icu key, revoked or invalid Strava grant: status `error`, automatic sync stops; use **Reconnect**.
- Strava rate limit or other transient errors: shown as "Last sync issue", retried automatically.
- Not configured on this deployment (missing env vars): the Strava card says so; the run endpoints answer 503.

## De-duplication and priority
- Same external id from the same provider is imported once (unique index).
- A ride matching an existing one (same user, start time and duration within 5 s, or same `.fit` hash) is not imported again.
- Priority Intervals.icu > Strava: when both deliver a ride, the Intervals.icu copy is kept (it replaces a Strava copy).
  Manual uploads and bot rides are never replaced or deleted by an import.
- Deleting a ride on Strava does not delete it in the app.

## Backfill
Per connection: last 30 days (default), 90 days, 1 year or full history (`backfill_days` NULL). Changing it restarts the
cursor so the new window is imported.

## Configuration (hosting env settings, never committed)
| Variable | Purpose |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Required for background sync, the Strava callback and webhook. Without it the run endpoints return 503. |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | Strava API app (https://www.strava.com/settings/api). The secret also signs the OAuth state. |

Strava app settings: **Authorization Callback Domain** = the production host (`velocity-stack-v2.vercel.app`).
The webhook subscription (one per Strava app, callback `{app_base_url}/api/webhooks/strava`) is created automatically when
the first rider connects, or manually with `POST /api/webhooks/strava/subscribe` while signed in. The verify token and
the cron token live in `public.sync_settings`; `app_base_url` there decides where pg_cron calls.

## Tests
CI runs `npm test` (`.github/workflows/test.yml`).
