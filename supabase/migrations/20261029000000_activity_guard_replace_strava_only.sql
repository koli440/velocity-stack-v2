-- Duplicate guard fix (#109 step 6). Additive and idempotent.
--
-- The guard let a higher-priority import pass whenever the matching row had a lower priority, and the
-- importer then deleted that row. That also covered manual uploads and bot activities, whose deletion
-- cascades to kudos, comments and photos. Now only an auto-imported Strava copy may be outranked (by
-- Intervals.icu); anything else matching start time/duration or file hash blocks the insert.
CREATE OR REPLACE FUNCTION public.guard_activity_duplicate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.activities a
        WHERE a.user_id = NEW.user_id
          AND NOT (
              a.source = 'strava'
              AND public.activity_source_priority(NEW.source) > public.activity_source_priority(a.source)
          )
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
