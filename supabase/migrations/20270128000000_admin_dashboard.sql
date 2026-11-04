-- Admin dashboard (aggregate-only). One admin-only SECURITY DEFINER RPC returns counts, daily series and anonymous
-- lists for suggestions, users, rides, templates and provider sync. It never returns user ids, names or e-mails,
-- and no table privileges or RLS policies are changed. Bots (profiles.is_bot / activities.source = 'bot') are excluded
-- from user and ride figures. "Active" = signed in or uploaded a ride in the window.
-- Additive and idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats(p_days INTEGER DEFAULT 30)
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

    WITH human AS (
        SELECT p.id, p.created_at,
               GREATEST(u.last_sign_in_at, (SELECT MAX(a.created_at) FROM public.activities a WHERE a.user_id = p.id)) AS last_seen,
               EXISTS (SELECT 1 FROM public.activities a WHERE a.user_id = p.id) AS has_rides
          FROM public.profiles p
          LEFT JOIN auth.users u ON u.id = p.id
         WHERE NOT p.is_bot
    ),
    days AS (SELECT d::date AS day FROM generate_series(v_from, CURRENT_DATE, interval '1 day') d)
    SELECT jsonb_build_object(
        'generated_at', NOW(),
        'days', v_days,
        'suggestions', jsonb_build_object(
            'pending', (SELECT COUNT(*) FROM public.suggestions WHERE status = 'pending'),
            'approved_30d', (SELECT COUNT(*) FROM public.suggestions WHERE status = 'approved' AND reviewed_at >= NOW() - interval '30 days'),
            'rejected_30d', (SELECT COUNT(*) FROM public.suggestions WHERE status = 'rejected' AND reviewed_at >= NOW() - interval '30 days'),
            'oldest_pending', (SELECT MIN(created_at) FROM public.suggestions WHERE status = 'pending'),
            'by_type', COALESCE((SELECT jsonb_agg(jsonb_build_object('entity_type', entity_type, 'count', n) ORDER BY n DESC, entity_type)
                                   FROM (SELECT entity_type, COUNT(*) AS n FROM public.suggestions WHERE status = 'pending' GROUP BY entity_type) t), '[]'::jsonb),
            'recent_pending', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'entity_type', entity_type, 'target_id', target_id, 'created_at', created_at))
                                          FROM (SELECT id, entity_type, target_id, created_at FROM public.suggestions
                                                 WHERE status = 'pending' ORDER BY created_at DESC LIMIT 10) r), '[]'::jsonb),
            'unmatched_exercises', (SELECT COUNT(DISTINCT name_key) FROM public.gym_exercises WHERE catalogue_id IS NULL),
            'open_comment_reports', (SELECT COUNT(*) FROM public.comment_reports WHERE status = 'open')
        ),
        'users', jsonb_build_object(
            'total', (SELECT COUNT(*) FROM human),
            'new_today', (SELECT COUNT(*) FROM human WHERE created_at >= CURRENT_DATE),
            'new_7d', (SELECT COUNT(*) FROM human WHERE created_at >= NOW() - interval '7 days'),
            'new_30d', (SELECT COUNT(*) FROM human WHERE created_at >= NOW() - interval '30 days'),
            'active_7d', (SELECT COUNT(*) FROM human WHERE last_seen >= NOW() - interval '7 days'),
            'active_30d', (SELECT COUNT(*) FROM human WHERE last_seen >= NOW() - interval '30 days'),
            'inactive_30d', (SELECT COUNT(*) FROM human WHERE last_seen IS NULL OR last_seen < NOW() - interval '30 days'),
            'never_uploaded', (SELECT COUNT(*) FROM human WHERE NOT has_rides),
            'coaching_active', (SELECT COUNT(*) FROM public.coaching_relationships WHERE status = 'active'),
            'coaching_pending', (SELECT COUNT(*) FROM public.coaching_relationships WHERE status = 'pending'),
            'signups_by_day', (SELECT jsonb_agg(jsonb_build_object('day', d.day, 'count', COALESCE(c.n, 0)) ORDER BY d.day)
                                 FROM days d LEFT JOIN (SELECT created_at::date AS day, COUNT(*) AS n FROM human GROUP BY 1) c USING (day))
        ),
        'rides', jsonb_build_object(
            'total', (SELECT COUNT(*) FROM public.activities WHERE source <> 'bot'),
            'new_today', (SELECT COUNT(*) FROM public.activities WHERE source <> 'bot' AND created_at >= CURRENT_DATE),
            'new_7d', (SELECT COUNT(*) FROM public.activities WHERE source <> 'bot' AND created_at >= NOW() - interval '7 days'),
            'new_30d', (SELECT COUNT(*) FROM public.activities WHERE source <> 'bot' AND created_at >= NOW() - interval '30 days'),
            'by_day', (SELECT jsonb_agg(jsonb_build_object('day', d.day, 'count', COALESCE(c.n, 0)) ORDER BY d.day)
                         FROM days d LEFT JOIN (SELECT created_at::date AS day, COUNT(*) AS n FROM public.activities
                                                 WHERE source <> 'bot' AND created_at >= v_from GROUP BY 1) c USING (day)),
            'by_source', COALESCE((SELECT jsonb_agg(jsonb_build_object('source', source, 'count', n) ORDER BY n DESC, source)
                                     FROM (SELECT source, COUNT(*) AS n FROM public.activities
                                            WHERE source <> 'bot' AND created_at >= v_from GROUP BY source) t), '[]'::jsonb),
            'by_type', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', activity_type, 'count', n) ORDER BY n DESC, activity_type)
                                   FROM (SELECT activity_type, COUNT(*) AS n FROM public.activities
                                          WHERE source <> 'bot' AND created_at >= v_from GROUP BY activity_type) t), '[]'::jsonb)
        ),
        'templates', jsonb_build_object(
            'user_private', (SELECT COUNT(*) FROM public.analysis_templates WHERE user_id IS NOT NULL AND visibility = 'private'),
            'user_public', (SELECT COUNT(*) FROM public.analysis_templates WHERE user_id IS NOT NULL AND visibility = 'public'),
            'system', (SELECT COUNT(*) FROM public.analysis_templates WHERE user_id IS NULL),
            'created_7d', (SELECT COUNT(*) FROM public.analysis_templates WHERE user_id IS NOT NULL AND created_at >= NOW() - interval '7 days'),
            'created_30d', (SELECT COUNT(*) FROM public.analysis_templates WHERE user_id IS NOT NULL AND created_at >= NOW() - interval '30 days'),
            'runs_total', (SELECT COUNT(*) FROM public.template_executions),
            'runs_7d', (SELECT COUNT(*) FROM public.template_executions WHERE created_at >= NOW() - interval '7 days'),
            'runs_30d', (SELECT COUNT(*) FROM public.template_executions WHERE created_at >= NOW() - interval '30 days'),
            'rerun_failed', (SELECT COUNT(*) FROM public.template_rerun_items WHERE NOT dry_run AND status = 'failed'),
            'created_by_day', (SELECT jsonb_agg(jsonb_build_object('day', d.day, 'count', COALESCE(c.n, 0)) ORDER BY d.day)
                                 FROM days d LEFT JOIN (SELECT created_at::date AS day, COUNT(*) AS n FROM public.analysis_templates
                                                         WHERE user_id IS NOT NULL AND created_at >= v_from GROUP BY 1) c USING (day)),
            'runs_by_day', (SELECT jsonb_agg(jsonb_build_object('day', d.day, 'count', COALESCE(c.n, 0)) ORDER BY d.day)
                              FROM days d LEFT JOIN (SELECT created_at::date AS day, COUNT(*) AS n FROM public.template_executions
                                                      WHERE created_at >= v_from GROUP BY 1) c USING (day))
        ),
        'sync', jsonb_build_object(
            'providers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'provider', g.provider, 'connected', g.connected, 'active', g.active, 'errors', g.errors,
                    'disconnected', g.disconnected, 'stale', g.stale, 'last_synced_at', g.last_synced_at,
                    'imported_24h', (SELECT COUNT(*) FROM public.activities a WHERE a.source = g.provider AND a.created_at >= NOW() - interval '24 hours'),
                    'imported_7d', (SELECT COUNT(*) FROM public.activities a WHERE a.source = g.provider AND a.created_at >= NOW() - interval '7 days')
                ) ORDER BY g.provider)
                FROM (SELECT provider,
                             COUNT(*) FILTER (WHERE status <> 'disconnected') AS connected,
                             COUNT(*) FILTER (WHERE status = 'active') AS active,
                             COUNT(*) FILTER (WHERE status = 'error') AS errors,
                             COUNT(*) FILTER (WHERE status = 'disconnected') AS disconnected,
                             COUNT(*) FILTER (WHERE status = 'active' AND (last_synced_at IS NULL OR last_synced_at < NOW() - interval '3 days')) AS stale,
                             MAX(last_synced_at) AS last_synced_at
                        FROM public.connections GROUP BY provider) g), '[]'::jsonb),
            'recent_errors', COALESCE((SELECT jsonb_agg(jsonb_build_object('provider', provider, 'message', msg, 'count', n, 'last_seen', last_seen)
                                                         ORDER BY n DESC, provider)
                                         FROM (SELECT provider, LEFT(regexp_replace(COALESCE(last_error, 'unknown'), '[0-9a-fA-F-]{20,}', '…', 'g'), 140) AS msg,
                                                      COUNT(*) AS n, MAX(updated_at) AS last_seen
                                                 FROM public.connections WHERE status = 'error' GROUP BY 1, 2 ORDER BY n DESC LIMIT 10) e), '[]'::jsonb),
            'garmin_events', jsonb_build_object(
                'received_24h', (SELECT COUNT(*) FROM public.garmin_activity_events WHERE received_at >= NOW() - interval '24 hours'),
                'received_7d', (SELECT COUNT(*) FROM public.garmin_activity_events WHERE received_at >= NOW() - interval '7 days'),
                'last_received_at', (SELECT MAX(received_at) FROM public.garmin_activity_events),
                'by_status_7d', COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, COUNT(*) AS n FROM public.garmin_activity_events
                                                                                    WHERE received_at >= NOW() - interval '7 days' GROUP BY status) s), '{}'::jsonb)
            )
        )
    ) INTO v_out
    FROM (SELECT 1) one;

    RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats(INTEGER) TO authenticated;
