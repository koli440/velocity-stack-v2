-- Admin dashboard: third-party (partner) app statistics. One admin-only SECURITY DEFINER RPC, aggregates only:
-- app names/slugs (already visible on /admin/partner-apps), counts, a daily upload series and recent failure texts.
-- No rider ids, names or e-mails. Additive and idempotent (CREATE OR REPLACE).

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
                'activities', COALESCE(c.n, 0)
            ) ORDER BY COALESCE(u.total, 0) DESC, a.name)
            FROM public.developer_apps a
            LEFT JOIN grants g ON g.app_id = a.id
            LEFT JOIN up u ON u.app_id = a.id
            LEFT JOIN aud x ON x.app_id = a.id
            LEFT JOIN acts c ON c.external_source = 'partner:' || a.slug
        ), '[]'::jsonb),
        'uploads_by_day', (SELECT jsonb_agg(jsonb_build_object('day', d.day, 'count', COALESCE(c.n, 0)) ORDER BY d.day)
                             FROM days d LEFT JOIN (SELECT created_at::date AS day, COUNT(*) AS n FROM public.partner_uploads GROUP BY 1) c USING (day)),
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
