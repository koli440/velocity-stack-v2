-- Season recap ("Wrapped"-style yearly summary) with opt-in public sharing.
--
--  * season_recap_compute(user, year): internal, stable, computed from stored rides (activity_type = 'ride')
--    dated in the calendar year (UTC). Missing data (no GPS, no power, no elevation, no velodrome) yields
--    NULL fields, never errors. Not executable by clients.
--  * season_recap(year): the signed-in rider's own recap (authenticated only; always auth.uid()).
--  * season_recap_shares: one optional public slug per rider and year. Private by default; no client grants.
--    get/enable/revoke_season_recap_share manage it for the caller; revoking deletes the row, so a later
--    re-enable creates a NEW slug and the old link stays dead.
--  * get_shared_season_recap(slug): anon-callable, returns the recap for a live slug without ride ids/titles.

CREATE TABLE IF NOT EXISTS public.season_recap_shares (
    user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    season_year INTEGER NOT NULL CHECK (season_year BETWEEN 2000 AND 2100),
    slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[0-9a-f]{20}$'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, season_year)
);

ALTER TABLE public.season_recap_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.season_recap_shares FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.season_recap_compute(p_user UUID, p_year INTEGER, p_public_only BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE sql STABLE SET search_path = public AS $$
    WITH rides AS (
        SELECT a.id, a.title, a.activity_date,
               (a.activity_date AT TIME ZONE 'UTC')::DATE AS d,
               a.track_id,
               NULLIF(a.distance_m, 0) AS distance_m,
               NULLIF(COALESCE(a.moving_time_s, a.duration_sec, a.elapsed_time_s), 0) AS secs,
               a.elevation_gain_m,
               a.max_power_w, a.avg_power_w, a.normalized_power_w,
               a.is_race,
               a.route_preview IS NOT NULL AS has_gps
        FROM public.activities a
        WHERE a.user_id = p_user
          AND a.activity_type = 'ride'
          AND (NOT p_public_only OR COALESCE(a.visibility, 'private') <> 'private')
          AND a.activity_date >= make_timestamptz(p_year, 1, 1, 0, 0, 0, 'UTC')
          AND a.activity_date <  make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'UTC')
    ),
    days AS (SELECT DISTINCT d FROM rides),
    islands AS (
        SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::INTEGER AS grp FROM days
    ),
    streaks AS (
        SELECT MIN(d) AS start_date, MAX(d) AS end_date, COUNT(*)::INTEGER AS len
        FROM islands GROUP BY grp
    ),
    months AS (
        SELECT EXTRACT(MONTH FROM d)::INTEGER AS m,
               COUNT(*)::INTEGER AS rides,
               SUM(distance_m) AS distance_m,
               SUM(secs) AS secs
        FROM rides GROUP BY 1
    ),
    fav AS (
        SELECT t.name, t.location, t.country_code, COUNT(*)::INTEGER AS rides
        FROM rides r JOIN public.tracks t ON t.id = r.track_id
        GROUP BY t.id, t.name, t.location, t.country_code
        ORDER BY COUNT(*) DESC, SUM(r.distance_m) DESC NULLS LAST, t.name
        LIMIT 1
    )
    SELECT jsonb_build_object(
        'year', p_year,
        'ride_count', (SELECT COUNT(*) FROM rides),
        'active_days', (SELECT COUNT(*) FROM days),
        'race_count', (SELECT COUNT(*) FROM rides WHERE is_race),
        'rides_with_gps', (SELECT COUNT(*) FROM rides WHERE has_gps),
        'distance_km', (SELECT ROUND(SUM(distance_m) / 1000.0, 1) FROM rides),
        'hours', (SELECT ROUND(SUM(secs) / 3600.0, 1) FROM rides),
        'elevation_m', (SELECT ROUND(SUM(elevation_gain_m)) FROM rides),
        'longest_ride', (
            SELECT jsonb_build_object('id', r.id, 'title', r.title, 'date', r.d,
                                      'distance_km', ROUND(r.distance_m / 1000.0, 1),
                                      'hours', ROUND(r.secs / 3600.0, 1))
            FROM rides r WHERE r.distance_m IS NOT NULL
            ORDER BY r.distance_m DESC, r.activity_date LIMIT 1
        ),
        'best_power', (
            SELECT CASE WHEN MAX(max_power_w) IS NULL AND MAX(avg_power_w) IS NULL AND MAX(normalized_power_w) IS NULL
                        THEN NULL
                        ELSE jsonb_build_object('max_power_w', MAX(max_power_w),
                                                'best_avg_power_w', MAX(avg_power_w),
                                                'best_np_w', MAX(normalized_power_w)) END
            FROM rides
        ),
        'personal_bests', jsonb_build_object(
            'count', (SELECT COUNT(*) FROM public.personal_bests pb
                      WHERE pb.user_id = p_user AND EXTRACT(YEAR FROM pb.achieved_date) = p_year),
            'items', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                           'discipline', x.discipline, 'event', x.event_name, 'time_seconds', x.time_seconds,
                           'track', x.track_name, 'date', x.achieved_date)
                       ORDER BY x.achieved_date DESC, x.time_seconds)
                FROM (SELECT pb.discipline, pb.event_name, pb.time_seconds, pb.track_name, pb.achieved_date
                      FROM public.personal_bests pb
                      WHERE pb.user_id = p_user AND EXTRACT(YEAR FROM pb.achieved_date) = p_year
                      ORDER BY pb.achieved_date DESC, pb.time_seconds LIMIT 5) x
            ), '[]'::JSONB)
        ),
        'longest_streak', (
            SELECT jsonb_build_object('days', s.len, 'start', s.start_date, 'end', s.end_date)
            FROM streaks s ORDER BY s.len DESC, s.start_date LIMIT 1
        ),
        'busiest_month', (
            SELECT jsonb_build_object('month', m.m, 'rides', m.rides,
                                      'distance_km', ROUND(m.distance_m / 1000.0, 1),
                                      'hours', ROUND(m.secs / 3600.0, 1))
            FROM months m ORDER BY m.distance_m DESC NULLS LAST, m.rides DESC, m.m LIMIT 1
        ),
        'months', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('month', g.m, 'rides', COALESCE(m.rides, 0),
                                                'distance_km', ROUND(COALESCE(m.distance_m, 0) / 1000.0, 1))
                             ORDER BY g.m)
            FROM generate_series(1, 12) g(m) LEFT JOIN months m ON m.m = g.m
        ), '[]'::JSONB),
        'favorite_velodrome', (
            SELECT jsonb_build_object('name', f.name, 'location', f.location,
                                      'country_code', f.country_code, 'rides', f.rides)
            FROM fav f
        )
    )
$$;
REVOKE ALL ON FUNCTION public.season_recap_compute(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.season_recap(p_year INTEGER)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
    END IF;
    IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
        RAISE EXCEPTION 'invalid year' USING ERRCODE = '22023';
    END IF;
    RETURN public.season_recap_compute(auth.uid(), p_year);
END
$$;
REVOKE ALL ON FUNCTION public.season_recap(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.season_recap(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_season_recap_share(p_year INTEGER)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT s.slug FROM public.season_recap_shares s
    WHERE s.user_id = auth.uid() AND s.season_year = p_year
$$;
REVOKE ALL ON FUNCTION public.get_season_recap_share(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_season_recap_share(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.enable_season_recap_share(p_year INTEGER)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_slug TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
    END IF;
    IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
        RAISE EXCEPTION 'invalid year' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.season_recap_shares (user_id, season_year, slug)
    VALUES (v_uid, p_year, SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 20))
    ON CONFLICT (user_id, season_year) DO NOTHING;
    SELECT s.slug INTO v_slug FROM public.season_recap_shares s
    WHERE s.user_id = v_uid AND s.season_year = p_year;
    RETURN v_slug;
END
$$;
REVOKE ALL ON FUNCTION public.enable_season_recap_share(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enable_season_recap_share(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_season_recap_share(p_year INTEGER)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM public.season_recap_shares WHERE user_id = auth.uid() AND season_year = p_year
$$;
REVOKE ALL ON FUNCTION public.revoke_season_recap_share(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_season_recap_share(INTEGER) TO authenticated;

-- Public read of a shared recap: totals only (no activity ids or titles), first name or nickname for display.
CREATE OR REPLACE FUNCTION public.get_shared_season_recap(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'year', s.season_year,
        'name', COALESCE(NULLIF(BTRIM(p.nickname), ''), NULLIF(BTRIM(p.first_name), ''), 'A rider'),
        'recap', public.season_recap_compute(s.user_id, s.season_year, TRUE) #- '{longest_ride,id}' #- '{longest_ride,title}'
    )
    FROM public.season_recap_shares s
    JOIN public.profiles p ON p.id = s.user_id
    WHERE s.slug = p_slug
      AND p_slug ~ '^[0-9a-f]{20}$'
$$;
REVOKE ALL ON FUNCTION public.get_shared_season_recap(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_season_recap(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
