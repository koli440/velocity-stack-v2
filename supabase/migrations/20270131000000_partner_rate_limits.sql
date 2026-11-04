-- Partner API rate limiting: per-app request counter in one-minute buckets (limits live on developer_apps).
-- Additive and idempotent. Service role only.

CREATE TABLE IF NOT EXISTS public.partner_rate_counters (
    app_id UUID NOT NULL REFERENCES public.developer_apps(id) ON DELETE CASCADE,
    bucket_start TIMESTAMPTZ NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (app_id, bucket_start)
);
ALTER TABLE public.partner_rate_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_rate_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.partner_rate_counters TO service_role;

-- Counts one request for the app in the current minute; returns the hits so far in this minute.
CREATE OR REPLACE FUNCTION public.partner_rate_hit(p_app UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_bucket TIMESTAMPTZ := date_trunc('minute', now());
    v_hits INTEGER;
BEGIN
    INSERT INTO public.partner_rate_counters (app_id, bucket_start, hits)
    VALUES (p_app, v_bucket, 1)
    ON CONFLICT (app_id, bucket_start) DO UPDATE SET hits = public.partner_rate_counters.hits + 1
    RETURNING hits INTO v_hits;
    -- housekeeping: keep an hour of buckets
    IF random() < 0.02 THEN
        DELETE FROM public.partner_rate_counters WHERE bucket_start < now() - interval '1 hour';
    END IF;
    RETURN v_hits;
END;
$$;
REVOKE ALL ON FUNCTION public.partner_rate_hit(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_rate_hit(UUID) TO service_role;

-- Developer registration: how many apps one owner may hold is enforced in the API; index for the lookup.
CREATE INDEX IF NOT EXISTS developer_apps_owner_idx ON public.developer_apps (owner_user_id);
CREATE INDEX IF NOT EXISTS partner_audit_log_app_idx ON public.partner_audit_log (app_id, created_at DESC);
