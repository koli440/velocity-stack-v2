-- Email for new notifications. Additive and idempotent.
-- pg_cron (every 5 min) -> pg_net POST {app_base_url}/api/notifications/email/run with the shared cron token
-- (public.sync_settings, see 20261027000000_intervals_auto_sync.sql). The endpoint sends through the mail
-- provider configured on the host (RESEND_API_KEY); without it the endpoint is a no-op.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ;

-- Existing notifications are never emailed retroactively.
UPDATE public.notifications SET emailed_at = NOW() WHERE emailed_at IS NULL AND created_at < NOW();

CREATE INDEX IF NOT EXISTS idx_notifications_unemailed
    ON public.notifications (created_at) WHERE emailed_at IS NULL AND read_at IS NULL;

CREATE OR REPLACE FUNCTION public.notification_email_trigger()
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
        SELECT 1 FROM public.notifications WHERE emailed_at IS NULL AND read_at IS NULL
    ) THEN
        RETURN;
    END IF;

    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/api/notifications/email/run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notification_email_trigger failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.notification_email_trigger() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-emails') THEN
        PERFORM cron.unschedule('notification-emails');
    END IF;
    PERFORM cron.schedule('notification-emails', '*/5 * * * *', 'SELECT public.notification_email_trigger()');
END;
$$;
