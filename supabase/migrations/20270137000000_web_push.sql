-- Web Push (system) notifications for the installed PWA. Additive and idempotent.
-- Browser subscriptions live in public.push_subscriptions (owner-only RLS, written through RPCs).
-- Delivery: an AFTER INSERT/UPDATE trigger on public.notifications (plus a 1-minute pg_cron safety net) calls
-- pg_net POST {app_base_url}/api/notifications/push/run with the shared cron token (public.sync_settings, see
-- 20261027000000_intervals_auto_sync.sql). The endpoint signs with the VAPID keys configured on the host and is a
-- no-op without them. See docs/push-notifications.md.

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;

-- Existing notifications are never pushed retroactively.
UPDATE public.notifications SET pushed_at = NOW() WHERE pushed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_unpushed
    ON public.notifications (created_at) WHERE pushed_at IS NULL AND read_at IS NULL;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint     TEXT NOT NULL UNIQUE,
    p256dh       TEXT NOT NULL,
    auth         TEXT NOT NULL,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    CONSTRAINT push_endpoint_https CHECK (endpoint ~ '^https://' AND char_length(endpoint) <= 2048),
    CONSTRAINT push_keys_len CHECK (char_length(p256dh) BETWEEN 1 AND 256 AND char_length(auth) BETWEEN 1 AND 128),
    CONSTRAINT push_ua_len CHECK (user_agent IS NULL OR char_length(user_agent) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Owners may read and remove their own devices; rows are created/updated only through save_push_subscription().
DROP POLICY IF EXISTS "push_subscriptions_select_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_select_own" ON public.push_subscriptions
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "push_subscriptions_delete_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_delete_own" ON public.push_subscriptions
    FOR DELETE USING (auth.uid() = user_id);

REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT SELECT, DELETE ON public.push_subscriptions TO authenticated;

-- Saves this device for the caller. An endpoint is unique per browser install, so a device that signs in as another
-- user is moved to that user (it can never push to two accounts).
CREATE OR REPLACE FUNCTION public.save_push_subscription(
    p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT, p_user_agent TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_id UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_bot) THEN
        RAISE EXCEPTION 'Not available for this account';
    END IF;
    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES (v_uid, btrim(p_endpoint), btrim(p_p256dh), btrim(p_auth), NULLIF(left(btrim(COALESCE(p_user_agent, '')), 200), ''))
    ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent, created_at = NOW()
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_push_subscription(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(TEXT) TO authenticated;

-- A refreshed unread notification (new comment/mention) is pushed again; same rule as the email column.
CREATE OR REPLACE FUNCTION public.reset_notification_emailed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.comment_id IS DISTINCT FROM OLD.comment_id AND NEW.read_at IS NULL THEN
        NEW.emailed_at := NULL;
        NEW.pushed_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

-- Asks the app to deliver pending pushes. Never fails the caller; a no-op without app_base_url/cron_token.
CREATE OR REPLACE FUNCTION public.notification_push_trigger()
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
    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/api/notifications/push/run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notification_push_trigger failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.notification_push_trigger() FROM PUBLIC, anon, authenticated;

-- Cron safety net: only calls out when something is waiting for a device that can receive it.
CREATE OR REPLACE FUNCTION public.notification_push_cron()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.pushed_at IS NULL AND n.read_at IS NULL
          AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = n.user_id)
    ) THEN
        PERFORM public.notification_push_trigger();
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notification_push_cron failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.notification_push_cron() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notification_push_after_write()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
    IF NEW.pushed_at IS NULL AND NEW.read_at IS NULL
       AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = NEW.user_id) THEN
        PERFORM public.notification_push_trigger();
    END IF;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notification_push_after_write failed: %', SQLERRM;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notification_push_after_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notification_push ON public.notifications;
CREATE TRIGGER trg_notification_push
    AFTER INSERT OR UPDATE OF comment_id, read_at, pushed_at ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.notification_push_after_write();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-push') THEN
        PERFORM cron.unschedule('notification-push');
    END IF;
    PERFORM cron.schedule('notification-push', '* * * * *', 'SELECT public.notification_push_cron()');
END;
$$;
