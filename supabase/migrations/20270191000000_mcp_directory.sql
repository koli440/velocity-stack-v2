-- MCP connector, directory readiness (docs/mcp.md). Additive and idempotent.
--
-- 1. Client ID Metadata Documents (CIMD): clients whose client_id is an https URL on a trusted host (Claude Code:
--    https://claude.ai/oauth/claude-code-client-metadata) are created on first use from their metadata document.
--    They have no owner, no secret (public client, PKCE only) and can be suspended at /admin/partner-apps like
--    any other app. cimd_fetched_at records when the document was last read.
-- 2. Per-rider rate limit: once every Velocity Stack user connects Claude through ONE directory app, a per-app
--    limit would throttle everybody together. /api/mcp counts requests per (app, rider) instead.

-- 1. CIMD clients -------------------------------------------------------------------------
ALTER TABLE public.developer_apps ALTER COLUMN owner_user_id DROP NOT NULL;
ALTER TABLE public.developer_apps ADD COLUMN IF NOT EXISTS cimd_fetched_at TIMESTAMPTZ;

-- 2. Per-rider request counter --------------------------------------------------------------
ALTER TABLE public.developer_apps ADD COLUMN IF NOT EXISTS rate_limit_per_user_min INTEGER NOT NULL DEFAULT 60;

CREATE TABLE IF NOT EXISTS public.partner_user_rate_counters (
    app_id UUID NOT NULL REFERENCES public.developer_apps(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bucket_start TIMESTAMPTZ NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (app_id, user_id, bucket_start)
);
ALTER TABLE public.partner_user_rate_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_user_rate_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.partner_user_rate_counters TO service_role;

-- Counts p_hits requests of the rider through the app in the current minute; returns the hits so far.
CREATE OR REPLACE FUNCTION public.partner_user_rate_hit(p_app UUID, p_user UUID, p_hits INTEGER DEFAULT 1)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_bucket TIMESTAMPTZ := date_trunc('minute', now());
    v_hits INTEGER;
BEGIN
    INSERT INTO public.partner_user_rate_counters (app_id, user_id, bucket_start, hits)
    VALUES (p_app, p_user, v_bucket, GREATEST(1, COALESCE(p_hits, 1)))
    ON CONFLICT (app_id, user_id, bucket_start)
        DO UPDATE SET hits = public.partner_user_rate_counters.hits + GREATEST(1, COALESCE(p_hits, 1))
    RETURNING hits INTO v_hits;
    IF random() < 0.02 THEN
        DELETE FROM public.partner_user_rate_counters WHERE bucket_start < now() - interval '1 hour';
    END IF;
    RETURN v_hits;
END;
$$;
REVOKE ALL ON FUNCTION public.partner_user_rate_hit(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_user_rate_hit(UUID, UUID, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
