-- Admin dashboard: PB Vault, Gear Architect and Pursuit Strategist usage.
--
-- 1. tool_usage_events: ANONYMOUS usage events of the two calculators (also public when logged out). Columns hold the tool, the event,
--    whether the visitor was signed in (a boolean only) and coarse values (discipline, distance, reason). There is NO user id,
--    IP, cookie or device identifier, so nothing can be linked to a person and unique visitors cannot be counted.
--    Clients have no table privileges; rows are written only by track_tool_event() (SECURITY DEFINER, anon + authenticated).
-- 2. track_tool_event(): strict allowlist of tool/event/reason, sanitised discipline, bounded distance, silent no-op on anything
--    else (never an error, so it leaks nothing), bots dropped (user-agent via PostgREST request headers, bot accounts), and a
--    global rate limit (no per-visitor key exists) that drops events beyond 300 per minute.
-- 3. prune_tool_usage_events(): deletes events older than 90 days, run daily by pg_cron.
-- 4. admin_pb_vault_stats() / admin_tool_usage_stats(): admin-only SECURITY DEFINER aggregates (raise 'Admin only'); no identities.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.tool_usage_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tool TEXT NOT NULL CHECK (tool IN ('gear', 'pursuit')),
    event TEXT NOT NULL CHECK (event IN ('view', 'calculate', 'compare', 'plan', 'pacing_on', 'pacing_fallback')),
    logged_in BOOLEAN NOT NULL DEFAULT FALSE,
    discipline TEXT CHECK (discipline IS NULL OR char_length(discipline) <= 40),
    distance_m INTEGER CHECK (distance_m IS NULL OR distance_m BETWEEN 1 AND 100000),
    my_pacing BOOLEAN,
    reason TEXT CHECK (reason IS NULL OR reason IN ('no-records', 'no-lap-data'))
);

CREATE INDEX IF NOT EXISTS idx_tool_usage_events_created ON public.tool_usage_events(created_at);

ALTER TABLE public.tool_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tool_usage_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_tool_event(
    p_tool TEXT,
    p_event TEXT,
    p_discipline TEXT DEFAULT NULL,
    p_distance_m NUMERIC DEFAULT NULL,
    p_my_pacing BOOLEAN DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_ua TEXT;
    v_discipline TEXT := NULLIF(btrim(p_discipline), '');
    v_distance INTEGER;
BEGIN
    IF NOT ((p_tool = 'gear' AND p_event IN ('view', 'calculate', 'compare'))
         OR (p_tool = 'pursuit' AND p_event IN ('view', 'plan', 'pacing_on', 'pacing_fallback'))) THEN
        RETURN;
    END IF;

    IF v_discipline IS NOT NULL AND (char_length(v_discipline) > 40 OR v_discipline !~ '^[A-Za-z0-9 ()/.,''+-]+$') THEN
        RETURN;
    END IF;
    IF p_distance_m IS NOT NULL THEN
        IF p_distance_m < 1 OR p_distance_m > 100000 THEN RETURN; END IF;
        v_distance := ROUND(p_distance_m)::INTEGER;
    END IF;
    IF p_reason IS NOT NULL AND p_reason NOT IN ('no-records', 'no-lap-data') THEN
        RETURN;
    END IF;
    -- Only the pursuit tool carries these; the pacing options exist for signed-in riders only.
    IF p_tool = 'gear' AND (v_distance IS NOT NULL OR p_my_pacing IS NOT NULL OR p_reason IS NOT NULL) THEN RETURN; END IF;
    IF p_event IN ('pacing_on', 'pacing_fallback') AND v_uid IS NULL THEN RETURN; END IF;
    IF p_event <> 'pacing_fallback' AND p_reason IS NOT NULL THEN RETURN; END IF;

    -- Bots: crawlers/scripts by user-agent, and the in-app bot accounts.
    BEGIN
        v_ua := lower(COALESCE(current_setting('request.headers', true)::json ->> 'user-agent', ''));
    EXCEPTION WHEN OTHERS THEN
        v_ua := '';
    END;
    IF v_ua = '' OR v_ua ~ 'bot|crawl|spider|slurp|curl/|wget|python|httpclient|headless|lighthouse|preview|monitor|node-fetch|axios|go-http' THEN
        RETURN;
    END IF;
    IF v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_bot) THEN
        RETURN;
    END IF;

    -- No visitor key exists, so the limit is global: at most 300 events per minute in total.
    IF (SELECT COUNT(*) FROM public.tool_usage_events WHERE created_at >= NOW() - INTERVAL '1 minute') >= 300 THEN
        RETURN;
    END IF;

    INSERT INTO public.tool_usage_events (tool, event, logged_in, discipline, distance_m, my_pacing, reason)
    VALUES (
        p_tool, p_event, v_uid IS NOT NULL,
        CASE WHEN p_tool = 'pursuit' THEN v_discipline END,
        CASE WHEN p_tool = 'pursuit' THEN v_distance END,
        CASE WHEN p_event = 'plan' AND v_uid IS NOT NULL THEN COALESCE(p_my_pacing, FALSE) END,
        p_reason
    );
END;
$$;

REVOKE ALL ON FUNCTION public.track_tool_event(TEXT, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_tool_event(TEXT, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.prune_tool_usage_events() RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_n BIGINT;
BEGIN
    DELETE FROM public.tool_usage_events WHERE created_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_tool_usage_events() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tool-usage-prune') THEN
        PERFORM cron.unschedule('tool-usage-prune');
    END IF;
    PERFORM cron.schedule('tool-usage-prune', '17 3 * * *', 'SELECT public.prune_tool_usage_events()');
END;
$$;

-- PB Vault: aggregates from personal_bests (bots excluded). "Usable laps" mirrors usableLapTimes() in src/lib/pacingCurve.js:
-- at least 2 splits, all positive, summing to the record time within 5%.
CREATE OR REPLACE FUNCTION public.admin_pb_vault_stats()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE
    v_out JSONB;
    v_week DATE := date_trunc('week', CURRENT_DATE)::date;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
    END IF;

    WITH pb AS (
        SELECT b.user_id, b.discipline, b.discipline_distance_m, b.created_at,
               (cardinality(b.lap_times) > 0) AS has_laps,
               (cardinality(b.lap_times) >= 2
                AND NOT EXISTS (SELECT 1 FROM unnest(b.lap_times) t WHERE t IS NULL OR t <= 0)
                AND ABS((SELECT SUM(t) FROM unnest(b.lap_times) t) - b.time_seconds) / b.time_seconds <= 0.05) AS usable
          FROM public.personal_bests b
          JOIN public.profiles p ON p.id = b.user_id
         WHERE NOT p.is_bot
    ),
    per_rider AS (SELECT user_id, COUNT(*) AS n, BOOL_OR(usable) AS eligible FROM pb GROUP BY user_id),
    weeks AS (SELECT d::date AS week FROM generate_series(v_week - 77, v_week, interval '7 days') d)
    SELECT jsonb_build_object(
        'generated_at', NOW(),
        'users_total', (SELECT COUNT(*) FROM public.profiles WHERE NOT is_bot),
        'riders', (SELECT COUNT(*) FROM per_rider),
        'records', (SELECT COUNT(*) FROM pb),
        'new_7d', (SELECT COUNT(*) FROM pb WHERE created_at >= NOW() - INTERVAL '7 days'),
        'new_30d', (SELECT COUNT(*) FROM pb WHERE created_at >= NOW() - INTERVAL '30 days'),
        'by_week', (SELECT jsonb_agg(jsonb_build_object('day', w.week, 'count', COALESCE(c.n, 0)) ORDER BY w.week)
                      FROM weeks w LEFT JOIN (SELECT date_trunc('week', created_at)::date AS week, COUNT(*) AS n FROM pb GROUP BY 1) c USING (week)),
        'by_discipline', COALESCE((SELECT jsonb_agg(jsonb_build_object('discipline', discipline, 'distance_m', distance_m, 'count', n) ORDER BY n DESC, discipline, distance_m)
                                     FROM (SELECT discipline, discipline_distance_m AS distance_m, COUNT(*) AS n FROM pb
                                            GROUP BY 1, 2 ORDER BY n DESC, discipline, distance_m LIMIT 10) t), '[]'::jsonb),
        'with_laps', (SELECT COUNT(*) FROM pb WHERE has_laps),
        'with_usable_laps', (SELECT COUNT(*) FROM pb WHERE usable),
        'pacing_eligible_riders', (SELECT COUNT(*) FROM per_rider WHERE eligible),
        'distribution', jsonb_build_object(
            'one', (SELECT COUNT(*) FROM per_rider WHERE n = 1),
            'two_to_five', (SELECT COUNT(*) FROM per_rider WHERE n BETWEEN 2 AND 5),
            'six_plus', (SELECT COUNT(*) FROM per_rider WHERE n >= 6)
        )
    ) INTO v_out;

    RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_pb_vault_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pb_vault_stats() TO authenticated;

-- Gear Architect + Pursuit Strategist: weekly event counts (12 weeks, signed-in vs public), event totals, pursuit disciplines/distances,
-- "My pacing" share and fallback reasons. Counts are events, not visitors.
CREATE OR REPLACE FUNCTION public.admin_tool_usage_stats()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE
    v_out JSONB;
    v_week DATE := date_trunc('week', CURRENT_DATE)::date;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
    END IF;

    WITH weeks AS (SELECT d::date AS week FROM generate_series(v_week - 77, v_week, interval '7 days') d),
    ev AS (SELECT *, date_trunc('week', created_at)::date AS week FROM public.tool_usage_events WHERE created_at >= v_week - 77),
    plans AS (SELECT * FROM ev WHERE tool = 'pursuit' AND event = 'plan')
    SELECT jsonb_build_object(
        'generated_at', NOW(),
        'weeks', (SELECT jsonb_agg(jsonb_build_object(
                        'week', w.week,
                        'gear_public', (SELECT COUNT(*) FROM ev WHERE ev.week = w.week AND tool = 'gear' AND NOT logged_in),
                        'gear_logged_in', (SELECT COUNT(*) FROM ev WHERE ev.week = w.week AND tool = 'gear' AND logged_in),
                        'pursuit_public', (SELECT COUNT(*) FROM ev WHERE ev.week = w.week AND tool = 'pursuit' AND NOT logged_in),
                        'pursuit_logged_in', (SELECT COUNT(*) FROM ev WHERE ev.week = w.week AND tool = 'pursuit' AND logged_in)
                  ) ORDER BY w.week) FROM weeks w),
        'gear_events', COALESCE((SELECT jsonb_agg(jsonb_build_object('event', event, 'logged_in', logged_in, 'count', n) ORDER BY event, logged_in)
                                   FROM (SELECT event, logged_in, COUNT(*) AS n FROM ev WHERE tool = 'gear' GROUP BY 1, 2) t), '[]'::jsonb),
        'pursuit_events', COALESCE((SELECT jsonb_agg(jsonb_build_object('event', event, 'logged_in', logged_in, 'count', n) ORDER BY event, logged_in)
                                      FROM (SELECT event, logged_in, COUNT(*) AS n FROM ev WHERE tool = 'pursuit' GROUP BY 1, 2) t), '[]'::jsonb),
        'pursuit_disciplines', COALESCE((SELECT jsonb_agg(jsonb_build_object('discipline', discipline, 'count', n) ORDER BY n DESC, discipline)
                                           FROM (SELECT discipline, COUNT(*) AS n FROM plans WHERE discipline IS NOT NULL
                                                  GROUP BY 1 ORDER BY n DESC, discipline LIMIT 10) t), '[]'::jsonb),
        'pursuit_distances', COALESCE((SELECT jsonb_agg(jsonb_build_object('discipline', discipline, 'distance_m', distance_m, 'count', n) ORDER BY n DESC, discipline, distance_m)
                                         FROM (SELECT discipline, distance_m, COUNT(*) AS n FROM plans WHERE discipline IS NOT NULL AND distance_m IS NOT NULL
                                                GROUP BY 1, 2 ORDER BY n DESC, discipline, distance_m LIMIT 10) t), '[]'::jsonb),
        'pursuit_plans_logged_in', (SELECT COUNT(*) FROM plans WHERE logged_in),
        'pursuit_plans_my_pacing', (SELECT COUNT(*) FROM plans WHERE my_pacing),
        'pacing_on', (SELECT COUNT(*) FROM ev WHERE tool = 'pursuit' AND event = 'pacing_on'),
        'pacing_fallbacks', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', reason, 'count', n) ORDER BY n DESC, reason)
                                        FROM (SELECT reason, COUNT(*) AS n FROM ev WHERE event = 'pacing_fallback' AND reason IS NOT NULL GROUP BY 1) t), '[]'::jsonb)
    ) INTO v_out;

    RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_tool_usage_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tool_usage_stats() TO authenticated;
