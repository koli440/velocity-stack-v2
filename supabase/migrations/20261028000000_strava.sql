-- Strava integration (#109 step 5). Additive and idempotent.
--
-- * public.sync_settings 'strava_webhook_verify_token': random value generated here (never in the repo),
--   echoed back to Strava during webhook subscription validation. Service-role only, like cron_token.
-- * pg_cron 'strava-sync' (every 15 min): fallback polling for Strava connections, calling
--   POST {app_base_url}/api/sync/strava/run with the same cron token as the Intervals job.
--   Silent no-op without app_base_url / token / active Strava connections.

INSERT INTO public.sync_settings (key, value)
VALUES ('strava_webhook_verify_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_trigger_strava()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_url TEXT;
    v_token TEXT;
BEGIN
    SELECT value INTO v_url FROM public.sync_settings WHERE key = 'app_base_url';
    SELECT value INTO v_token FROM public.sync_settings WHERE key = 'cron_token';
    IF NULLIF(btrim(v_url), '') IS NULL OR v_token IS NULL THEN
        RETURN;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.connections
        WHERE provider = 'strava' AND status = 'active' AND refresh_token IS NOT NULL
    ) THEN
        RETURN;
    END IF;

    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/api/sync/strava/run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_trigger_strava failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_trigger_strava() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'strava-sync') THEN
        PERFORM cron.unschedule('strava-sync');
    END IF;
    PERFORM cron.schedule('strava-sync', '*/15 * * * *', 'SELECT public.sync_trigger_strava()');
END;
$$;
