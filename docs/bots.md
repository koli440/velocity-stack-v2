# Bot riders

Synthetic "bot" riders that real users can follow. They produce new rides every
day so the social features (feed, follow, notifications) can be tested.

Everything lives in the database and is deployed purely by migrations
(`20261017000000_bot_accounts.sql`, `20261018000000_bot_generator.sql`).
No external credentials, GitHub secrets or workflows are required.

## What exists

- 6 personas in `bot_personas`: sprinter, endurance, beginner, pursuiter, keirin, masters.
  Each has gear, home track, power/cadence ranges and a weekly ride pattern.
- Bot auth users (`bot-<key>@bots.velocity-stack.invalid`, unusable password) and
  `profiles` rows with `is_bot = true`; the UI shows a bot badge.
- `bots_generate_ride(persona, date)`: deterministic per bot+date (`setseed`),
  random ride/no-ride per weekly pattern, slow fitness trend, 1 Hz simulated
  watts/cadence/speed/torque, flying-200 / pack / endurance session plans,
  metrics (NP, IF, load), `route_preview`, `curves_data`, `activity_curves`,
  and a `200m Flying` personal best when applicable.
- `bots_run_day()` runs via `pg_cron` job `bots-daily` at 04:30 UTC and
  generates the last 3 days (idempotent, so missed runs self-heal).
- Follow-back: trigger `bots_follow_back` on `follows`; when a real user follows
  a bot the bot follows back unless a block exists between them.
- The migration backfills 60 days.

## Operations (SQL only)

```sql
select public.bots_reset(60);   -- delete bot rides and regenerate the last 60 days
select public.bots_run_range(current_date - 7, current_date - 1);
```

## Tradeoffs vs. real synced rides

- Rides are inserted directly; there is no `.fit` file and `/api/analyze` is not
  called. Metrics and curves are computed in SQL with the same semantics.
- `badges` is `[]` (not computed for bots).
- Mean-max curves sample windows of 5 minutes or more every 5 s to bound cost.
- Personal bests are private by RLS (own rows only), so other users cannot see
  bot PBs until a leaderboard exists.
- Data is plausible, not physically exact (simple speed/power model plus noise).
- `pg_cron` schedule is not directly observable from GitHub; check
  `select * from cron.job_run_details` in the Supabase dashboard if needed.
