-- Review (#26): drop columns that the application never reads or writes.
--
-- public.profiles.username / full_name / avatar_url / weight_kg: superseded by the
-- first_name/last_name/nickname fields actually used by the register and profile
-- settings flows (see 20261003000000_profile_missing_columns.sql); never queried
-- anywhere in the app.
-- public.tracks.banking_deg: seeded velodrome metadata that is never read back.
-- public.activities.fit_file_path: superseded by raw_file_url (raw-activity-files
-- storage bucket, see 20260925000000_activity_analyzer.sql).
-- public.activities.session_mode / segmentation_mode: legacy Activity Wizard
-- fields missed by 20260927000000_remove_wizard_fields.sql; never read/written.
-- public.analysis_templates.is_default: set on seed insert but never queried or
-- used to filter/select templates anywhere in the app.

ALTER TABLE public.profiles
    DROP COLUMN IF EXISTS username,
    DROP COLUMN IF EXISTS full_name,
    DROP COLUMN IF EXISTS avatar_url,
    DROP COLUMN IF EXISTS weight_kg;

ALTER TABLE public.tracks
    DROP COLUMN IF EXISTS banking_deg;

ALTER TABLE public.activities
    DROP COLUMN IF EXISTS fit_file_path,
    DROP COLUMN IF EXISTS session_mode,
    DROP COLUMN IF EXISTS segmentation_mode;

ALTER TABLE public.analysis_templates
    DROP COLUMN IF EXISTS is_default;
