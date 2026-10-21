-- Strava backfills used to list rides with `after`, which Strava answers oldest-first. The first page was the
-- oldest 100 rides of the window, the cursor landed inside it and the backfill was marked complete, leaving
-- the rides between that page and the forward-sync range unimported. Re-open the backfill once for every
-- active Strava connection that finished one; rides already imported are skipped by external id, so this is
-- safe. Intervals.icu connections are not touched.
UPDATE public.connections
SET backfill_complete = FALSE,
    backfill_cursor = NULL,
    backfill_imported = 0,
    backfill_total = NULL,
    last_attempt_at = NULL,
    updated_at = NOW()
WHERE provider = 'strava'
  AND status <> 'disconnected'
  AND backfill_complete = TRUE;
