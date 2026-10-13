# Synthetic bot riders (issue #80)

Six bot accounts (`scripts/bots/personas.mjs`) ride on a daily schedule so real users can follow them and
exercise the social features. They are flagged `profiles.is_bot` and show a **bot** badge in the feed
and follow panel.

- **Daily run**: `.github/workflows/bots-daily.yml` (cron + manual) runs `scripts/bots/daily.mjs`.
  Each bot rides or rests by a seeded, per-weekday probability; the ride (1 Hz power/cadence/speed/HR/GPS, flying 200 m
  efforts, pack surges or endurance laps, slow fitness trend) is encoded as `.fit`, analyzed by the deployed
  `/api/analyze`, and stored with `buildActivityInsert` (public visibility, curves, route preview, badges, 200 m flying PBs).
  The same bot + date always yields the same ride; re-running a day is idempotent.
- **Follow back**: bots follow back real riders who follow them (blocks respected).
- **Reset/reseed**: `npm run bots:reset -- --backfill-days 60` (or workflow dispatch with `reset`).
- **Secrets**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`. Bot users are `bot-<persona>@bots.velocity-stack.invalid` with random passwords.
- Apply migration `20261017000000_bot_accounts.sql` first.
