-- The app (register page, profile settings modal, theme toggle, intervals sync,
-- activity metrics visibility) reads/writes a number of public.profiles columns
-- that were never defined in a migration (they appear to have been added
-- directly in the Supabase dashboard at some point). Add them here so the
-- schema in source control matches what the application actually requires,
-- and so a fresh/other environment provisioned from these migrations works.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name TEXT,
    ADD COLUMN IF NOT EXISTS nickname TEXT,
    ADD COLUMN IF NOT EXISTS home_track_id UUID REFERENCES public.tracks(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS default_chainring INTEGER,
    ADD COLUMN IF NOT EXISTS default_cog INTEGER,
    ADD COLUMN IF NOT EXISTS crank_length_mm NUMERIC(4, 1) DEFAULT 165.0,
    ADD COLUMN IF NOT EXISTS theme_preference TEXT,
    ADD COLUMN IF NOT EXISTS intervals_athlete_id TEXT,
    ADD COLUMN IF NOT EXISTS intervals_api_key TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
