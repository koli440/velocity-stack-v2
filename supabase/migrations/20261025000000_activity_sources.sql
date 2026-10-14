-- Activity provenance + external ids (issues #41 / #109).
-- source: where the row came from; external_source/external_id: the platform's own activity id,
-- used by automatic import (Intervals.icu, Strava) for idempotent upserts.
ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS external_source TEXT,
    ADD COLUMN IF NOT EXISTS external_id TEXT;

ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_source_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_source_check
    CHECK (source IN ('manual', 'intervals', 'strava', 'bot')) NOT VALID;
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_external_pair_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_external_pair_check
    CHECK ((external_source IS NULL) = (external_id IS NULL)) NOT VALID;

-- Unique only for rows that carry an external id, so existing rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_activities_user_external
    ON public.activities (user_id, external_source, external_id)
    WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activities_user_start_time
    ON public.activities (user_id, start_time);

-- Source priority: intervals (has the .fit file) > strava > everything else.
CREATE OR REPLACE FUNCTION public.activity_source_priority(p_source TEXT)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE p_source WHEN 'intervals' THEN 3 WHEN 'strava' THEN 2 ELSE 1 END;
$$;

-- Insert-only duplicate guard (same rules as src/lib/activityDuplicates.js): rejects a new
-- activity when the same user already has one with the same file_sha256, or with start_time
-- and elapsed_time_s both within 5s, unless the new row outranks the existing one (so an
-- Intervals import can replace a Strava copy). Existing rows are never checked or modified.
CREATE OR REPLACE FUNCTION public.guard_activity_duplicate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.activities a
        WHERE a.user_id = NEW.user_id
          AND public.activity_source_priority(a.source) >= public.activity_source_priority(NEW.source)
          AND (
              (NEW.file_sha256 IS NOT NULL AND a.file_sha256 = NEW.file_sha256)
              OR (
                  NEW.start_time IS NOT NULL AND NEW.elapsed_time_s IS NOT NULL
                  AND a.start_time BETWEEN NEW.start_time - interval '5 seconds'
                                       AND NEW.start_time + interval '5 seconds'
                  AND a.elapsed_time_s IS NOT NULL
                  AND abs(a.elapsed_time_s - NEW.elapsed_time_s) <= 5
              )
          )
    ) THEN
        RAISE EXCEPTION 'duplicate activity for user (same file or matching start time/duration)'
            USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_activity_duplicate ON public.activities;
CREATE TRIGGER trg_guard_activity_duplicate
    BEFORE INSERT ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.guard_activity_duplicate();
