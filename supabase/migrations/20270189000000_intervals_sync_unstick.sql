-- Intervals.icu sync stalled when one ride had no data (404 was treated as rejected credentials and the
-- connection was parked in status 'error', which the cron skips). Re-activate those connections once; a genuinely
-- bad key fails again with 401/403 and is flagged properly. Idempotent.
UPDATE public.connections
SET status = 'active', last_error = NULL, last_attempt_at = NULL, updated_at = NOW()
WHERE provider = 'intervals'
  AND status = 'error'
  AND (api_key IS NOT NULL OR access_token IS NOT NULL)
  AND last_error LIKE 'Intervals.icu rejected the credentials%';

NOTIFY pgrst, 'reload schema';
