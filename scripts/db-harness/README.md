# Scratch Postgres harness

Applies ALL `supabase/migrations` on a throw-away local Postgres with stubbed Supabase pieces (roles, `auth.*`, `storage.*`, pg_net, pg_cron)
and runs adversarial SQL tests. Not part of CI; dependencies are not in package.json:

    mkdir /tmp/pg && cd /tmp/pg && npm i embedded-postgres pg
    cp <repo>/scripts/db-harness/*.mjs . 
    MIG=<repo>/supabase/migrations/20261208000000_planned_workout_intervals_push.sql \
      node harness.mjs <repo>/supabase/migrations ./planned-push-adversarial.mjs

`20261009000000_import_v1_tracks.sql` fails on the stub (pre-existing, unrelated).

Ride type / gears (issue #279): `MIG=<repo>/supabase/migrations/20261225000000_ride_type_and_gears.sql node harness.mjs <repo>/supabase/migrations ./ride-gear-adversarial.mjs`

Template reference prefs and the template re-run job (issue #283):
`MIG=<repo>/supabase/migrations/20261228000000_template_reference_prefs.sql node harness.mjs <repo>/supabase/migrations ./template-prefs-adversarial.mjs`
`MIG=<repo>/supabase/migrations/20261228010000_template_rerun_job.sql node harness.mjs <repo>/supabase/migrations ./template-rerun-adversarial.mjs`

Race tag (issue #294): `MIG=<repo>/supabase/migrations/20261230000000_activity_race_tag.sql node harness.mjs <repo>/supabase/migrations ./race-tag-adversarial.mjs`

Planned workout auto-link: `MIG=<repo>/supabase/migrations/20261231000000_planned_workout_auto_link.sql node harness.mjs <repo>/supabase/migrations ./planned-auto-link-adversarial.mjs`
