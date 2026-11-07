-- Admin dashboard: "Respect" (activity reaction) statistics. One admin-only SECURITY DEFINER RPC, aggregates only:
-- counts, a daily series and anonymous splits. It never returns user ids, names or e-mails, and no table privileges or
-- RLS policies are changed. Bots (profiles.is_bot / activities.source = 'bot') are excluded. "Active" = signed in or
-- uploaded a ride in the window. Rate-limit hits are not recorded (the limit just raises an error), so none are shown.
-- Additive and idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.admin_respect_stats(p_days INTEGER DEFAULT 30)
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
        SELECT p.id, p.reactions_enabled, p.reaction_notifications,
               (COALESCE(u.last_sign_in_at, 'epoch'::timestamptz) >= v_from
                OR EXISTS (SELECT 1 FROM public.activities a WHERE a.user_id = p.id AND a.created_at >= v_from)) AS active
          FROM public.profiles p
          LEFT JOIN auth.users u ON u.id = p.id
         WHERE NOT p.is_bot
    ),
    rx AS (
        SELECT r.activity_id, r.user_id AS reactor_id, a.user_id AS owner_id, r.created_at,
               a.activity_type, (a.visibility = 'public') AS is_public
          FROM public.activity_reactions r
          JOIN public.activities a ON a.id = r.activity_id
          JOIN human hr ON hr.id = r.user_id
          JOIN human ho ON ho.id = a.user_id
         WHERE r.type = 'respect' AND a.source <> 'bot' AND r.created_at >= v_from
    ),
    days AS (SELECT d::date AS day FROM generate_series(v_from, CURRENT_DATE, interval '1 day') d)
    SELECT jsonb_build_object(
        'generated_at', NOW(),
        'days', v_days,
        'total', (SELECT COUNT(*) FROM rx),
        'total_all_time', (SELECT COUNT(*) FROM public.activity_reactions r
                             JOIN public.activities a ON a.id = r.activity_id
                             JOIN human hr ON hr.id = r.user_id
                            WHERE r.type = 'respect' AND a.source <> 'bot'),
        'reactors', (SELECT COUNT(DISTINCT reactor_id) FROM rx),
        'activities', (SELECT COUNT(DISTINCT activity_id) FROM rx),
        'receivers', (SELECT COUNT(DISTINCT owner_id) FROM rx),
        'active_users', (SELECT COUNT(*) FROM human WHERE active),
        'active_gave', (SELECT COUNT(DISTINCT reactor_id) FROM rx JOIN human h ON h.id = rx.reactor_id WHERE h.active),
        'active_received', (SELECT COUNT(DISTINCT owner_id) FROM rx JOIN human h ON h.id = rx.owner_id WHERE h.active),
        'by_day', (SELECT jsonb_agg(jsonb_build_object('day', d.day, 'count', COALESCE(c.n, 0)) ORDER BY d.day)
                     FROM days d LEFT JOIN (SELECT created_at::date AS day, COUNT(*) AS n FROM rx GROUP BY 1) c USING (day)),
        'by_type', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', activity_type, 'count', n) ORDER BY n DESC, activity_type)
                               FROM (SELECT activity_type, COUNT(*) AS n FROM rx GROUP BY activity_type) t), '[]'::jsonb),
        'by_visibility', jsonb_build_object(
            'public', (SELECT COUNT(*) FROM rx WHERE is_public),
            'non_public', (SELECT COUNT(*) FROM rx WHERE NOT is_public)
        ),
        'notifications_sent', (SELECT COUNT(*) FROM public.notifications n
                                 JOIN human h ON h.id = n.user_id
                                WHERE n.type = 'activity_reaction' AND n.created_at >= v_from),
        'notified_reactions', (SELECT COALESCE(SUM(n.event_count), 0) FROM public.notifications n
                                 JOIN human h ON h.id = n.user_id
                                WHERE n.type = 'activity_reaction' AND n.created_at >= v_from),
        'opt_out_reactions', (SELECT COUNT(*) FROM human WHERE NOT reactions_enabled),
        'opt_out_notifications', (SELECT COUNT(*) FROM human WHERE NOT reaction_notifications),
        'users_total', (SELECT COUNT(*) FROM human)
    ) INTO v_out
    FROM (SELECT 1) one;

    RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_respect_stats(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_respect_stats(INTEGER) TO authenticated;
