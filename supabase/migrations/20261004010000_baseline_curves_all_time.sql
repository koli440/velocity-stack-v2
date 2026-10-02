-- Issue #28 follow-up: the "All-time" baseline option in DurationalCurvesChart was
-- previously backed by a legacy get_athlete_master_curves RPC that was never actually
-- defined in any migration (it only ever existed, if at all, as a manual/ad-hoc object
-- in the live database). As a result "All-time" silently showed no baseline curve while
-- every other period worked correctly.
--
-- Fix: extend get_athlete_baseline_curves (added in 20261004000000_baseline_curves.sql)
-- to also support an 'all_time' period with no lower date bound, so "All-time" goes
-- through the same, actually-existing RPC as every other period - and gets the same
-- per-point activity attribution/link as a bonus.

CREATE OR REPLACE FUNCTION public.get_athlete_baseline_curves(
  p_user_id UUID,
  p_period TEXT,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
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

GRANT EXECUTE ON FUNCTION public.get_athlete_baseline_curves(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
