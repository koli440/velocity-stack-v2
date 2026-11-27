-- Admin dashboard: Claude / MCP connector usage in the "Third-party apps" panel (docs/admin.md, docs/mcp.md).
--
--  * mcp_tool_usage: calls and errors per app, UTC day and tool (tool names only, no arguments, no rider).
--  * mcp_active_riders: which riders used the connector on a day, only to COUNT distinct riders (7d / 30d). The
--    admin RPC returns counts only, never ids. Both tables keep 90 days (pruned on write) and are service-role only.
--  * mcp_usage_hit(app, user, tool, error): called by /api/mcp after every known tool call. Service role only.
--  * admin_partner_stats is replaced with the same output plus per-app MCP columns (kind cimd|registered, calls,
--    errors, riders, writes) and an `mcp` block (totals, rate limits, CIMD clients, calls per day, per-tool table).
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.mcp_tool_usage (
    app_id UUID NOT NULL REFERENCES public.developer_apps(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    tool TEXT NOT NULL CHECK (tool ~ '^[a-z][a-z0-9_]{0,63}$'),
    calls INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (app_id, day, tool)
);
CREATE INDEX IF NOT EXISTS mcp_tool_usage_day_idx ON public.mcp_tool_usage (day);
ALTER TABLE public.mcp_tool_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_tool_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mcp_tool_usage TO service_role;

CREATE TABLE IF NOT EXISTS public.mcp_active_riders (
    app_id UUID NOT NULL REFERENCES public.developer_apps(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    PRIMARY KEY (app_id, day, user_id)
);
CREATE INDEX IF NOT EXISTS mcp_active_riders_day_idx ON public.mcp_active_riders (day);
ALTER TABLE public.mcp_active_riders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_active_riders FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mcp_active_riders TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_usage_hit(p_app UUID, p_user UUID, p_tool TEXT, p_error BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_day DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
BEGIN
    IF p_app IS NULL OR p_tool IS NULL OR p_tool !~ '^[a-z][a-z0-9_]{0,63}$' THEN
        RETURN;
    END IF;
    INSERT INTO public.mcp_tool_usage (app_id, day, tool, calls, errors)
    VALUES (p_app, v_day, p_tool, 1, CASE WHEN p_error THEN 1 ELSE 0 END)
    ON CONFLICT (app_id, day, tool) DO UPDATE
        SET calls = public.mcp_tool_usage.calls + 1,
            errors = public.mcp_tool_usage.errors + CASE WHEN p_error THEN 1 ELSE 0 END;
    IF p_user IS NOT NULL THEN
        INSERT INTO public.mcp_active_riders (app_id, day, user_id) VALUES (p_app, v_day, p_user)
        ON CONFLICT DO NOTHING;
    END IF;
    IF random() < 0.01 THEN
        DELETE FROM public.mcp_tool_usage WHERE day < v_day - 90;
        DELETE FROM public.mcp_active_riders WHERE day < v_day - 90;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mcp_usage_hit(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_usage_hit(UUID, UUID, TEXT, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_partner_stats(p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE
    v_days INTEGER := GREATEST(7, LEAST(COALESCE(p_days, 30), 90));
    v_from DATE := (CURRENT_DATE - (GREATEST(7, LEAST(COALESCE(p_days, 30), 90)) - 1));
    v_out JSONB;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
    END IF;

    WITH days AS (SELECT d::date AS day FROM generate_series(v_from, CURRENT_DATE, interval '1 day') d),
    grants AS (
        SELECT app_id, COUNT(DISTINCT user_id) AS riders
          FROM public.oauth_grants WHERE revoked_at IS NULL AND rotated_at IS NULL GROUP BY app_id
    ),
    up AS (
        SELECT app_id,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE created_at >= NOW() - interval '24 hours') AS d1,
               COUNT(*) FILTER (WHERE created_at >= NOW() - interval '7 days') AS d7,
               COUNT(*) FILTER (WHERE created_at >= NOW() - interval '30 days') AS d30,
               COUNT(*) FILTER (WHERE status = 'completed') AS imported,
               COUNT(*) FILTER (WHERE status = 'duplicate') AS duplicate,
               COUNT(*) FILTER (WHERE status = 'failed') AS failed,
               MAX(created_at) AS last_upload_at
          FROM public.partner_uploads GROUP BY app_id
    ),
    aud AS (
        SELECT app_id,
               COUNT(*) FILTER (WHERE event = 'rate_limited' AND created_at >= NOW() - interval '7 days') AS rate_limited_7d,
               COUNT(*) FILTER (WHERE event = 'refresh' AND created_at >= NOW() - interval '7 days') AS refreshes_7d,
               COUNT(*) FILTER (WHERE event = 'refresh_reuse') AS reuse_revocations
          FROM public.partner_audit_log WHERE app_id IS NOT NULL GROUP BY app_id
    ),
    mcp_app AS (
        SELECT app_id,
               SUM(calls) FILTER (WHERE day > CURRENT_DATE - 7) AS calls_7d,
               SUM(calls) FILTER (WHERE day > CURRENT_DATE - 30) AS calls_30d,
               SUM(errors) FILTER (WHERE day > CURRENT_DATE - 7) AS errors_7d
          FROM public.mcp_tool_usage GROUP BY app_id
    ),
    mcp_riders AS (
        SELECT app_id, COUNT(DISTINCT user_id) AS riders_7d
          FROM public.mcp_active_riders WHERE day > CURRENT_DATE - 7 GROUP BY app_id
    ),
    mcp_writes AS (
        SELECT app_id, COUNT(*) AS writes_7d
          FROM public.partner_audit_log
         WHERE event = 'mcp_write' AND created_at >= NOW() - interval '7 days' AND app_id IS NOT NULL
         GROUP BY app_id
    ),
    acts AS (
        SELECT external_source, COUNT(*) AS n FROM public.activities WHERE external_source LIKE 'partner:%' GROUP BY external_source
    )
    SELECT jsonb_build_object(
        'generated_at', NOW(),
        'days', v_days,
        'apps_by_status', jsonb_build_object(
            'pending', (SELECT COUNT(*) FROM public.developer_apps WHERE status = 'pending'),
            'approved', (SELECT COUNT(*) FROM public.developer_apps WHERE status = 'approved'),
            'suspended', (SELECT COUNT(*) FROM public.developer_apps WHERE status = 'suspended')
        ),
        'connected_riders', (SELECT COUNT(DISTINCT user_id) FROM public.oauth_grants WHERE revoked_at IS NULL AND rotated_at IS NULL),
        'apps', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', a.id, 'name', a.name, 'slug', a.slug, 'status', a.status,
                'riders', COALESCE(g.riders, 0),
                'uploads_24h', COALESCE(u.d1, 0), 'uploads_7d', COALESCE(u.d7, 0), 'uploads_30d', COALESCE(u.d30, 0),
                'uploads_total', COALESCE(u.total, 0),
                'imported', COALESCE(u.imported, 0), 'duplicate', COALESCE(u.duplicate, 0), 'failed', COALESCE(u.failed, 0),
                'last_upload_at', u.last_upload_at,
                'rate_limited_7d', COALESCE(x.rate_limited_7d, 0),
                'refreshes_7d', COALESCE(x.refreshes_7d, 0),
                'reuse_revocations', COALESCE(x.reuse_revocations, 0),
                'activities', COALESCE(c.n, 0),
                'kind', CASE WHEN a.owner_user_id IS NULL AND a.client_id LIKE 'https://%' THEN 'cimd' ELSE 'registered' END,
                'mcp_calls_7d', COALESCE(m.calls_7d, 0),
                'mcp_calls_30d', COALESCE(m.calls_30d, 0),
                'mcp_errors_7d', COALESCE(m.errors_7d, 0),
                'mcp_riders_7d', COALESCE(mr.riders_7d, 0),
                'mcp_writes_7d', COALESCE(mw.writes_7d, 0)
            ) ORDER BY COALESCE(u.total, 0) + COALESCE(m.calls_30d, 0) DESC, a.name)
            FROM public.developer_apps a
            LEFT JOIN grants g ON g.app_id = a.id
            LEFT JOIN up u ON u.app_id = a.id
            LEFT JOIN aud x ON x.app_id = a.id
            LEFT JOIN acts c ON c.external_source = 'partner:' || a.slug
            LEFT JOIN mcp_app m ON m.app_id = a.id
            LEFT JOIN mcp_riders mr ON mr.app_id = a.id
            LEFT JOIN mcp_writes mw ON mw.app_id = a.id
        ), '[]'::jsonb),
        'uploads_by_day', (SELECT jsonb_agg(jsonb_build_object('day', d.day, 'count', COALESCE(c.n, 0)) ORDER BY d.day)
                             FROM days d LEFT JOIN (SELECT created_at::date AS day, COUNT(*) AS n FROM public.partner_uploads GROUP BY 1) c USING (day)),
        'mcp', jsonb_build_object(
            'calls_7d', (SELECT COALESCE(SUM(calls), 0) FROM public.mcp_tool_usage WHERE day > CURRENT_DATE - 7),
            'calls_30d', (SELECT COALESCE(SUM(calls), 0) FROM public.mcp_tool_usage WHERE day > CURRENT_DATE - 30),
            'errors_7d', (SELECT COALESCE(SUM(errors), 0) FROM public.mcp_tool_usage WHERE day > CURRENT_DATE - 7),
            'riders_7d', (SELECT COUNT(DISTINCT user_id) FROM public.mcp_active_riders WHERE day > CURRENT_DATE - 7),
            'riders_30d', (SELECT COUNT(DISTINCT user_id) FROM public.mcp_active_riders WHERE day > CURRENT_DATE - 30),
            'writes_7d', (SELECT COUNT(*) FROM public.partner_audit_log WHERE event = 'mcp_write' AND created_at >= NOW() - interval '7 days'),
            'rate_limited_7d', (SELECT COUNT(*) FROM public.partner_audit_log
                                 WHERE event = 'rate_limited' AND metadata->>'via' = 'mcp' AND created_at >= NOW() - interval '7 days'),
            'cimd_clients', (SELECT COUNT(*) FROM public.developer_apps WHERE owner_user_id IS NULL AND client_id LIKE 'https://%'),
            'calls_by_day', (SELECT jsonb_agg(jsonb_build_object('day', d.day, 'count', COALESCE(c.n, 0)) ORDER BY d.day)
                               FROM days d LEFT JOIN (SELECT day, SUM(calls) AS n FROM public.mcp_tool_usage GROUP BY day) c USING (day)),
            'tools', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('tool', t.tool, 'calls_7d', t.c7, 'calls_30d', t.c30, 'errors_30d', t.e30)
                                 ORDER BY t.c30 DESC, t.tool)
                  FROM (SELECT tool,
                               COALESCE(SUM(calls) FILTER (WHERE day > CURRENT_DATE - 7), 0) AS c7,
                               SUM(calls) AS c30,
                               SUM(errors) AS e30
                          FROM public.mcp_tool_usage WHERE day > CURRENT_DATE - 30 GROUP BY tool) t
            ), '[]'::jsonb)
        ),
        'recent_failures', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('app', f.name, 'message', f.msg, 'created_at', f.created_at) ORDER BY f.created_at DESC)
              FROM (SELECT a.name, pu.created_at, LEFT(regexp_replace(COALESCE(pu.error, 'unknown'), '[0-9a-fA-F-]{20,}', '…', 'g'), 160) AS msg
                      FROM public.partner_uploads pu JOIN public.developer_apps a ON a.id = pu.app_id
                     WHERE pu.status = 'failed' ORDER BY pu.created_at DESC LIMIT 10) f
        ), '[]'::jsonb)
    ) INTO v_out;

    RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_partner_stats(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_partner_stats(INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
