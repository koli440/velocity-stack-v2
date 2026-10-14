-- Automatic Intervals.icu sync (#109 step 4). Additive and idempotent.
--
-- pg_cron (every 15 min) -> pg_net POST {app_base_url}/api/sync/intervals/run with a shared token.
-- The token is generated here (never committed) and lives in public.sync_settings, which only
-- service_role / postgres can read; the endpoint verifies the header against that row using the
-- service client. No external secret or scheduled GitHub workflow is needed.
--
-- Without an 'app_base_url' row (or without a token) the job is a safe no-op.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Service-only key/value settings.
CREATE TABLE IF NOT EXISTS public.sync_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.sync_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sync_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sync_settings TO service_role;

INSERT INTO public.sync_settings (key, value)
VALUES ('cron_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;

-- Production URL of the app (Vercel). Change the row to repoint the job; never overwritten here.
INSERT INTO public.sync_settings (key, value)
VALUES ('app_base_url', 'https://velocity-stack-v2.vercel.app')
ON CONFLICT (key) DO NOTHING;

-- Sync bookkeeping. last_attempt_at orders/claims connections so failing ones don't starve others.
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

-- A larger backfill window must be re-imported: restart the sync cursor for that connection.
CREATE OR REPLACE FUNCTION public.set_connection_backfill(p_provider TEXT, p_backfill_days INTEGER)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_backfill_days IS NOT NULL AND (p_backfill_days < 1 OR p_backfill_days > 36500) THEN
        RAISE EXCEPTION 'backfill_days out of range' USING ERRCODE = '22023';
    END IF;
    UPDATE public.connections
    SET backfill_days = p_backfill_days, last_synced_at = NULL, last_attempt_at = NULL, updated_at = NOW()
    WHERE user_id = auth.uid() AND provider = p_provider;
END;
$$;
REVOKE ALL ON FUNCTION public.set_connection_backfill(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_connection_backfill(TEXT, INTEGER) TO authenticated;

-- Service-side outcome recording (the sync runs as service_role, where auth.uid() is NULL).
--   p_error NULL            -> success: status 'active', last_error cleared
--   p_error + p_fatal       -> status 'error' (e.g. invalid key): the cron stops retrying until reconnect/manual sync
--   p_error + NOT p_fatal   -> keeps status, only records last_error (transient / partial failure)
-- p_synced_at (optional) moves the sync cursor; disconnected rows are left alone.
CREATE OR REPLACE FUNCTION public.record_connection_result_for(
    p_user_id UUID, p_provider TEXT, p_error TEXT DEFAULT NULL,
    p_fatal BOOLEAN DEFAULT FALSE, p_synced_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.connections
    SET status = CASE WHEN p_error IS NULL THEN 'active' WHEN p_fatal THEN 'error' ELSE status END,
        last_error = left(p_error, 500),
        last_synced_at = COALESCE(p_synced_at, last_synced_at),
        updated_at = NOW()
    WHERE user_id = p_user_id AND provider = p_provider AND status <> 'disconnected';
END;
$$;
REVOKE ALL ON FUNCTION public.record_connection_result_for(UUID, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_connection_result_for(UUID, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;

-- Cron entry point: pings the app when there is something to sync. Silent no-op when not configured.
CREATE OR REPLACE FUNCTION public.sync_trigger_intervals()
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
        WHERE provider = 'intervals' AND status = 'active' AND api_key IS NOT NULL
    ) THEN
        RETURN;
    END IF;

    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/api/sync/intervals/run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_trigger_intervals failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_trigger_intervals() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'intervals-sync') THEN
        PERFORM cron.unschedule('intervals-sync');
    END IF;
    PERFORM cron.schedule('intervals-sync', '*/15 * * * *', 'SELECT public.sync_trigger_intervals()');
END;
$$;
