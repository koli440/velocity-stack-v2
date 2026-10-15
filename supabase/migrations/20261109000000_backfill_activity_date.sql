-- Activities saved through /api/activities/save were dated with the upload time.
-- Where the ride's real start time is known, use it so feed and template-run
-- ordering follow when the ride was done. Idempotent.
UPDATE public.activities
SET activity_date = start_time
WHERE start_time IS NOT NULL
  AND activity_date IS DISTINCT FROM start_time;
