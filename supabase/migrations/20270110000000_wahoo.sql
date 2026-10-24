-- Direct Wahoo Cloud integration (#311). Additive and idempotent.
--
-- * connections.provider and activities.source accept 'wahoo'.
-- * activity_source_priority(): intervals 3 = wahoo 3 > strava 2 > other 1. Wahoo rides arrive as .fit, so they
--   replace a Strava copy of the same ride; against Intervals.icu it is a tie, and the guard (which only lets an
--   outranked *Strava* copy through) makes the first one win with no replacement.
--   guard_activity_duplicate() is unchanged: it already calls activity_source_priority().
-- * pg_cron 'wahoo-sync' (every 15 min): safety-net polling, POST {app_base_url}/api/sync/wahoo/run with the shared
--   cron token. Silent no-op without app_base_url / token / active Wahoo connections.
-- Wahoo env vars (WAHOO_CLIENT_ID, WAHOO_CLIENT_SECRET, WAHOO_WEBHOOK_TOKEN) live in the hosting settings, never here.

ALTER TABLE public.connections DROP CONSTRAINT IF EXISTS connections_provider_check;
ALTER TABLE public.connections ADD CONSTRAINT connections_provider_check
    CHECK (provider IN ('intervals', 'strava', 'wahoo'));

ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_source_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_source_check
    CHECK (source IN ('manual', 'intervals', 'strava', 'wahoo', 'bot')) NOT VALID;

CREATE OR REPLACE FUNCTION public.activity_source_priority(p_source TEXT)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE p_source WHEN 'intervals' THEN 3 WHEN 'wahoo' THEN 3 WHEN 'strava' THEN 2 ELSE 1 END;
$$;

CREATE OR REPLACE FUNCTION public.sync_trigger_wahoo()
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
        WHERE provider = 'wahoo' AND status = 'active' AND refresh_token IS NOT NULL
    ) THEN
        RETURN;
    END IF;

    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/api/sync/wahoo/run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_trigger_wahoo failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_trigger_wahoo() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wahoo-sync') THEN
        PERFORM cron.unschedule('wahoo-sync');
    END IF;
    PERFORM cron.schedule('wahoo-sync', '*/15 * * * *', 'SELECT public.sync_trigger_wahoo()');
END;
$$;
