-- Admin dashboard: anonymous blog analytics (post views, "New on the blog" feed card impressions/clicks, 75% read depth).
--
-- A sibling table to tool_usage_events (not an extension of it): that table's tool/event CHECKs and columns are specific to the
-- calculators, and blog events need a slug column. The privacy model is identical: NO user id, IP, cookie or device identifier;
-- only a signed-in boolean decided server-side. Unique readers cannot be counted, only events.
--   * blog_events: clients have no table privileges; rows are written only by track_blog_event() (SECURITY DEFINER, anon + authenticated).
--   * track_blog_event(): strict event allowlist, slug must match the post-slug pattern (max 80 chars; posts live in markdown files,
--     not the database, so existence cannot be checked here - the admin panel only shows slugs of currently published posts),
--     silent no-op on anything else, bots dropped (user-agent, bot accounts), global rate limit of 300 events per minute.
--   * prune_tool_usage_events(): extended to also delete blog_events older than 90 days (existing daily pg_cron job).
--   * admin_blog_stats(): admin-only SECURITY DEFINER aggregate, no identities.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.blog_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event TEXT NOT NULL CHECK (event IN ('blog_view', 'blog_card_impression', 'blog_card_click', 'blog_read_75')),
    slug TEXT NOT NULL CHECK (char_length(slug) <= 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    logged_in BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_blog_events_created ON public.blog_events(created_at);

ALTER TABLE public.blog_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blog_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_blog_event(p_event TEXT, p_slug TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_ua TEXT;
BEGIN
    IF p_event IS NULL OR p_event NOT IN ('blog_view', 'blog_card_impression', 'blog_card_click', 'blog_read_75') THEN RETURN; END IF;
    IF p_slug IS NULL OR char_length(p_slug) > 80 OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN RETURN; END IF;

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
    IF (SELECT COUNT(*) FROM public.blog_events WHERE created_at >= NOW() - INTERVAL '1 minute') >= 300 THEN
        RETURN;
    END IF;

    INSERT INTO public.blog_events (event, slug, logged_in) VALUES (p_event, p_slug, v_uid IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.track_blog_event(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_blog_event(TEXT, TEXT) TO anon, authenticated;

-- Same daily cron job (tool-usage-prune), now also pruning blog events.
CREATE OR REPLACE FUNCTION public.prune_tool_usage_events() RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_n BIGINT;
    v_b BIGINT;
BEGIN
    DELETE FROM public.tool_usage_events WHERE created_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    DELETE FROM public.blog_events WHERE created_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS v_b = ROW_COUNT;
    RETURN v_n + v_b;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_tool_usage_events() FROM PUBLIC, anon, authenticated;

-- Weekly post views (12 weeks, signed-in vs public) and per-slug totals. Counts are events, not readers.
CREATE OR REPLACE FUNCTION public.admin_blog_stats()
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
    ev AS (SELECT *, date_trunc('week', created_at)::date AS week FROM public.blog_events)
    SELECT jsonb_build_object(
        'generated_at', NOW(),
        'weeks', (SELECT jsonb_agg(jsonb_build_object(
                        'week', w.week,
                        'public', (SELECT COUNT(*) FROM ev WHERE ev.week = w.week AND event = 'blog_view' AND NOT logged_in),
                        'logged_in', (SELECT COUNT(*) FROM ev WHERE ev.week = w.week AND event = 'blog_view' AND logged_in)
                  ) ORDER BY w.week) FROM weeks w),
        'posts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'slug', slug,
                        'views_30d', views_30d, 'views', views, 'views_logged_in', views_in,
                        'impressions', impressions, 'clicks', clicks, 'read_75', reads
                  ) ORDER BY views DESC, slug)
                  FROM (SELECT slug,
                               COUNT(*) FILTER (WHERE event = 'blog_view' AND created_at >= NOW() - INTERVAL '30 days') AS views_30d,
                               COUNT(*) FILTER (WHERE event = 'blog_view') AS views,
                               COUNT(*) FILTER (WHERE event = 'blog_view' AND logged_in) AS views_in,
                               COUNT(*) FILTER (WHERE event = 'blog_card_impression') AS impressions,
                               COUNT(*) FILTER (WHERE event = 'blog_card_click') AS clicks,
                               COUNT(*) FILTER (WHERE event = 'blog_read_75') AS reads
                          FROM ev GROUP BY slug) t), '[]'::jsonb)
    ) INTO v_out;

    RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_blog_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_blog_stats() TO authenticated;
