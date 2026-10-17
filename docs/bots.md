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

## Avatars

Each persona has a generated avatar (`public/avatars/bots/<persona>.png`, produced by
`node scripts/generate-bot-avatars.mjs`). Migration `20261022000000_profile_images.sql` sets
`profiles.avatar_url = '/avatars/bots/<persona>.png'` for the bot profiles.
They are bundled app assets rather than objects in the `avatars` storage bucket because uploading to
storage needs the service-role key, which this project does not use outside migrations. The
`avatar_url` CHECK constraint only allows this path form for `is_bot` rows.

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

## Coaching with bots (SQL only)

Bots take part in coaching so it can be tested alone (details in docs/coaching.md):

- **Bot as athlete:** open a bot's rider profile and press *Invite as athlete*. The bot accepts instantly; use the
  coach dashboard, `/coach/<botId>`, calendar and physiology edits.
- **Bot as coach:** press *Request as my coach* on a bot profile (you must not have a coach yet). The bot accepts
  instantly; Settings shows *My coach*, and you can revoke it.
- **Let the bot coach change your data** (SQL editor / migrations only, not callable by clients). This runs the normal
  triggers: "set by coach" badges, the audit list and a `coach_edited` notification appear on your account.

```sql
-- find ids
select id, nickname from public.profiles where is_bot;
select public.bots_coach_edit('<bot id>', '<your user id>', p_ftp_w => 310, p_weight_kg => 72.5);
select public.bots_coach_edit('<bot id>', '<your user id>', p_lt1_power_w => 200, p_lt2_power_w => 280, p_effective_from => date '2026-01-01');
select public.bots_coach_edit('<bot id>', '<your user id>', p_profile => '{"default_chainring": 50, "crank_length_mm": 170}');
```

It fails unless the bot is an active coach of that rider.
