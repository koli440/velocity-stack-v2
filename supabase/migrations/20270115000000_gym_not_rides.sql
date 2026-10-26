-- Gym sessions are not rides (follow-up to #326 / #328 / #330). Audit of every server-side aggregate:
--
--  * rider_stats.public_ride_count ("N public rides" on rider profiles / lists) counted every public
--    activity, gym sessions included. It now counts rides only; last_public_activity_date still moves
--    with any public activity (a rider who just trained is "recently active").
--  * coach_dashboard() 7-day sessions / time / distance / load now cover rides only (same scope as the
--    coach's Fitness / Fatigue / Form); gym sessions are reported separately as week_gym_count.
--    last_activity_at still counts every activity.
--  * get_athlete_baseline_curves() (power profile, durational-curve baselines) ignores gym sessions, so a
--    gym heart-rate curve can never become a rider's "best".
-- Idempotent; no secrets or manual steps.

-- 1. Public ride count ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_rider_stats(p_user UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.rider_stats AS rs (user_id, last_public_activity_date, public_ride_count)
    SELECT p_user, max(a.activity_date)::date, count(*) FILTER (WHERE a.activity_type = 'ride')
    FROM public.activities a
    WHERE a.user_id = p_user AND a.visibility = 'public'
    ON CONFLICT (user_id) DO UPDATE
        SET last_public_activity_date = EXCLUDED.last_public_activity_date,
            public_ride_count = EXCLUDED.public_ride_count
    WHERE EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_rider_stats()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.visibility = 'public' THEN
            INSERT INTO public.rider_stats AS rs (user_id, last_public_activity_date, public_ride_count)
            SELECT NEW.user_id, NEW.activity_date::date, CASE WHEN NEW.activity_type = 'ride' THEN 1 ELSE 0 END
            WHERE EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id)
            ON CONFLICT (user_id) DO UPDATE
                SET last_public_activity_date = GREATEST(rs.last_public_activity_date, EXCLUDED.last_public_activity_date),
                    public_ride_count = rs.public_ride_count + EXCLUDED.public_ride_count;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.visibility = 'public' THEN PERFORM public.refresh_rider_stats(OLD.user_id); END IF;
    ELSE
        IF OLD.visibility = 'public' OR NEW.visibility = 'public' THEN
            PERFORM public.refresh_rider_stats(NEW.user_id);
            IF OLD.user_id <> NEW.user_id THEN PERFORM public.refresh_rider_stats(OLD.user_id); END IF;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rider_stats_upd ON public.activities;
CREATE TRIGGER trg_rider_stats_upd
    AFTER UPDATE OF visibility, activity_date, user_id, activity_type ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.trg_rider_stats();

UPDATE public.rider_stats rs
   SET public_ride_count = s.n
  FROM (
        SELECT a.user_id, count(*) FILTER (WHERE a.activity_type = 'ride')::INTEGER AS n
        FROM public.activities a
        WHERE a.visibility = 'public'
        GROUP BY a.user_id
       ) s
 WHERE rs.user_id = s.user_id AND rs.public_ride_count IS DISTINCT FROM s.n;

-- 2. Coach dashboard -----------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.coach_dashboard();
CREATE FUNCTION public.coach_dashboard()
RETURNS TABLE (
    rider_id UUID,
    since TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    week_count INTEGER,
    week_moving_time_s BIGINT,
    week_distance_m NUMERIC,
    week_training_load NUMERIC,
    week_gym_count INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT c.rider_id,
           COALESCE(c.responded_at, c.created_at),
           (SELECT MAX(a.activity_date) FROM public.activities a WHERE a.user_id = c.rider_id),
           (SELECT COUNT(*)::INTEGER FROM public.activities a
             WHERE a.user_id = c.rider_id AND a.activity_type = 'ride' AND a.activity_date >= NOW() - INTERVAL '7 days'),
           (SELECT COALESCE(SUM(a.moving_time_s), 0)::BIGINT FROM public.activities a
             WHERE a.user_id = c.rider_id AND a.activity_type = 'ride' AND a.activity_date >= NOW() - INTERVAL '7 days'),
           (SELECT COALESCE(SUM(a.distance_m), 0) FROM public.activities a
             WHERE a.user_id = c.rider_id AND a.activity_type = 'ride' AND a.activity_date >= NOW() - INTERVAL '7 days'),
           (SELECT COALESCE(SUM(a.training_load), 0) FROM public.activities a
             WHERE a.user_id = c.rider_id AND a.activity_type = 'ride' AND a.activity_date >= NOW() - INTERVAL '7 days'),
           (SELECT COUNT(*)::INTEGER FROM public.activities a
             WHERE a.user_id = c.rider_id AND a.activity_type = 'gym' AND a.activity_date >= NOW() - INTERVAL '7 days')
    FROM public.coaching_relationships c
    WHERE c.coach_id = auth.uid()
      AND c.status = 'active'
      AND public.is_coach_of(c.rider_id)
    ORDER BY 3 DESC NULLS LAST
$$;
REVOKE ALL ON FUNCTION public.coach_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_dashboard() TO authenticated;

-- 3. Baseline curves: rides only (same body as 20261129000000 plus the type filter) ---------------
CREATE OR REPLACE FUNCTION public.get_athlete_baseline_curves(
  p_user_id UUID,
  p_period TEXT,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ := COALESCE(p_end_date, NOW());
  v_curves JSONB;
BEGIN
  IF p_period = 'all_time' THEN
    v_start := '-infinity'::TIMESTAMPTZ;
  ELSIF p_period = '30d' THEN
    v_start := v_end - INTERVAL '30 days';
  ELSIF p_period = '90d' THEN
    v_start := v_end - INTERVAL '90 days';
  ELSIF p_period = 'calendar_year' THEN
    v_start := date_trunc('year', v_end);
  ELSIF p_period = 'rolling_year' THEN
    v_start := v_end - INTERVAL '365 days';
  ELSIF p_period = 'custom' THEN
    IF p_start_date IS NULL OR p_end_date IS NULL THEN
      RAISE EXCEPTION 'custom baseline period requires both p_start_date and p_end_date';
    END IF;
    v_start := p_start_date;
    v_end := p_end_date;
  ELSE
    RAISE EXCEPTION 'Unknown baseline period: %', p_period;
  END IF;

  WITH scoped_activities AS (
    SELECT a.id, a.title, a.activity_date
    FROM public.activities a
    WHERE a.user_id = p_user_id
      AND a.activity_type = 'ride'
      AND (a.user_id = auth.uid() OR public.is_coach_of(a.user_id))
      AND a.activity_date >= v_start
      AND a.activity_date <= v_end
  ),
  curve_points AS (
    SELECT
      ac.curve_type,
      kv.key AS duration_key,
      (kv.value)::NUMERIC AS value,
      sa.id AS activity_id,
      sa.title AS activity_title,
      sa.activity_date
    FROM public.activity_curves ac
    JOIN scoped_activities sa ON sa.id = ac.activity_id
    CROSS JOIN LATERAL jsonb_each_text(ac.data) AS kv(key, value)
    WHERE kv.value IS NOT NULL AND kv.value <> 'null'
  ),
  ranked AS (
    -- Best value per metric/duration; ties favour the earliest activity.
    SELECT DISTINCT ON (curve_type, duration_key)
      curve_type, duration_key, value, activity_id, activity_title, activity_date
    FROM curve_points
    ORDER BY curve_type, duration_key, value DESC, activity_date ASC
  ),
  metric_objects AS (
    SELECT
      curve_type,
      jsonb_object_agg(
        duration_key,
        jsonb_build_object(
          'value', value,
          'activityId', activity_id,
          'activityTitle', activity_title,
          'activityDate', activity_date
        )
      ) AS durations
    FROM ranked
    GROUP BY curve_type
  )
  SELECT COALESCE(jsonb_object_agg(curve_type, durations), '{}'::JSONB)
  INTO v_curves
  FROM metric_objects;

  RETURN jsonb_build_object(
    'period', p_period,
    'start', v_start,
    'end', v_end,
    'curves', v_curves
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_athlete_baseline_curves(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_athlete_baseline_curves(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
