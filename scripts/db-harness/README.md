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

Google sign-in profiles: `MIG=<repo>/supabase/migrations/20270101000000_oauth_signup_profile.sql node harness.mjs <repo>/supabase/migrations ./oauth-signup-adversarial.mjs`

Gym load (issue #336): `MIG=<repo>/supabase/migrations/20270124000000_gym_load.sql node harness.mjs <repo>/supabase/migrations ./gym-load-adversarial.mjs`

Gym editing (issue #335): `MIG=<repo>/supabase/migrations/20270116000000_gym_editing.sql node harness.mjs <repo>/supabase/migrations ./gym-editing-adversarial.mjs`

Activity reactions: `MIG=<repo>/supabase/migrations/20270138000000_activity_reactions.sql node harness.mjs <repo>/supabase/migrations ./reactions-adversarial.mjs`

Velodrome is_indoor suggestion (approve applies it to tracks): `node harness.mjs <repo>/supabase/migrations ./velodrome-indoor-adversarial.mjs`

Exercise catalogue: `MIG=<repo>/supabase/migrations/20270125000000_exercise_catalogue.sql node harness.mjs <repo>/supabase/migrations ./exercise-catalogue-adversarial.mjs`

Threshold apply permissions (issue #379): `MIG=<repo>/supabase/migrations/20270127000000_threshold_apply_source.sql node harness.mjs <repo>/supabase/migrations ./threshold-apply-adversarial.mjs`

Admin dashboard RPC (admin-only, aggregate-only): `MIG=<repo>/supabase/migrations/20270128000000_admin_dashboard.sql node harness.mjs <repo>/supabase/migrations ./admin-dashboard-adversarial.mjs`

Velodrome track info (provenance, contact privacy, open/closed status): `node harness.mjs <repo>/supabase/migrations ./velodrome-track-info-adversarial.mjs`

Velodrome info data migrations (helper + strict/relaxed chunks + penrose; tolerant, fill-only, idempotent, skip log). The test re-applies the whole `20270136*` set, so run it against a copy of the migrations plus a throw-away `CREATE UNIQUE INDEX tracks_name_uq ON public.tracks(name)` migration (versioned `20260924000001`) so the v1 track import applies on the stub: `node harness.mjs <copy-of-migrations> ./velodrome-info-data-adversarial.mjs` (`MIGDIR=<repo>/supabase/migrations` if the test file was copied out of the repo).

Web Push: `MIG=<repo>/supabase/migrations/20270137000000_web_push.sql node harness.mjs <repo>/supabase/migrations ./web-push-adversarial.mjs`

Admin Respect stats RPC: `MIG=<repo>/supabase/migrations/20270140000000_admin_respect_stats.sql node harness.mjs <repo>/supabase/migrations ./admin-respect-adversarial.mjs`

Coach module flag + notes: `MIG=<repo>/supabase/migrations/20270151000000_coach_module_flag_and_notes.sql node harness.mjs <repo>/supabase/migrations ./coach-notes-adversarial.mjs`
Coach card + directory: `MIG=<repo>/supabase/migrations/20270152000000_coach_cards.sql node harness.mjs <repo>/supabase/migrations ./coach-card-adversarial.mjs`
Coach card media: `MIG=<repo>/supabase/migrations/20270157000000_coach_card_media.sql node harness.mjs <repo>/supabase/migrations ./coach-card-media-adversarial.mjs`
Lab protocol runner: `MIG=<repo>/supabase/migrations/20270158000000_lab_runs.sql node harness.mjs <repo>/supabase/migrations ./lab-runs-adversarial.mjs`
Lab lactate step test: `MIG=<repo>/supabase/migrations/20270159000000_lab_lactate.sql node harness.mjs <repo>/supabase/migrations ./lab-lactate-adversarial.mjs`
Lab test scheduler: `MIG=<repo>/supabase/migrations/20270160000000_lab_scheduler.sql node harness.mjs <repo>/supabase/migrations ./lab-scheduler-adversarial.mjs`
Lab field forms: `MIG=<repo>/supabase/migrations/20270164000000_lab_field_forms.sql node harness.mjs <repo>/supabase/migrations ./lab-forms-adversarial.mjs`
Lab reports: `MIG=<repo>/supabase/migrations/20270165000000_lab_reports.sql node harness.mjs <repo>/supabase/migrations ./lab-reports-adversarial.mjs`
Pay after accept: `MIG=<repo>/supabase/migrations/20270171000000_coach_pay_after_accept.sql node harness.mjs <repo>/supabase/migrations ./coach-pay-after-accept-adversarial.mjs`

Directory verified licence: `MIG=<repo>/supabase/migrations/20270174000000_directory_verified_licence.sql node harness.mjs <repo>/supabase/migrations ./directory-licence-adversarial.mjs`

Licence admin notification: `MIG=<repo>/supabase/migrations/20270173000000_licence_admin_notify.sql node harness.mjs <repo>/supabase/migrations ./licence-admin-notify-adversarial.mjs`
Application single path: `MIG=<repo>/supabase/migrations/20270175000000_application_single_path.sql node harness.mjs <repo>/supabase/migrations ./application-single-path-adversarial.mjs`
Equipment checkboxes: `MIG=<repo>/supabase/migrations/20270176000000_application_equipment_checkboxes.sql node harness.mjs <repo>/supabase/migrations ./onboarding-adversarial.mjs`

Free period: `MIG=<repo>/supabase/migrations/20270172000000_coach_free_period.sql node harness.mjs <repo>/supabase/migrations ./coach-free-period-adversarial.mjs`

Coach onboarding: `MIG=<repo>/supabase/migrations/20270153000000_coach_onboarding.sql node harness.mjs <repo>/supabase/migrations ./onboarding-adversarial.mjs`
Coach chat: `MIG=<repo>/supabase/migrations/20270154000000_coach_chat.sql node harness.mjs <repo>/supabase/migrations ./chat-adversarial.mjs`
Coach licences: `MIG=<repo>/supabase/migrations/20270155000000_coach_licences.sql node harness.mjs <repo>/supabase/migrations ./licence-adversarial.mjs`
Coach billing: `MIG=<repo>/supabase/migrations/20270156000000_coach_billing.sql node harness.mjs <repo>/supabase/migrations ./billing-adversarial.mjs`
