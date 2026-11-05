-- DRAFT: not applied. Move to supabase/migrations with a fresh timestamp once approved.
-- Adds researched venue info to public.tracks plus per-field provenance. Idempotent.

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS booking_url TEXT,
  ADD COLUMN IF NOT EXISTS operator TEXT,
  ADD COLUMN IF NOT EXISTS year_built SMALLINT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS opening_hours TEXT,
  ADD COLUMN IF NOT EXISTS pricing_url TEXT,
  ADD COLUMN IF NOT EXISTS price_min NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS price_max NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS price_currency CHAR(3),
  ADD COLUMN IF NOT EXISTS price_check_site BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS info_verified_at DATE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracks_year_built_chk') THEN
    ALTER TABLE public.tracks ADD CONSTRAINT tracks_year_built_chk
      CHECK (year_built IS NULL OR year_built BETWEEN 1850 AND 2100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracks_price_range_chk') THEN
    ALTER TABLE public.tracks ADD CONSTRAINT tracks_price_range_chk
      CHECK (price_min IS NULL OR price_max IS NULL OR price_min <= price_max);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.track_info_sources (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  value TEXT,
  source_url TEXT NOT NULL,
  evidence_quote TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  verified_at DATE NOT NULL,
  UNIQUE (track_id, field, verified_at)
);

CREATE INDEX IF NOT EXISTS track_info_sources_track_idx ON public.track_info_sources (track_id);

ALTER TABLE public.track_info_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "track_info_sources_read" ON public.track_info_sources;
CREATE POLICY "track_info_sources_read" ON public.track_info_sources
  FOR SELECT USING (true);
