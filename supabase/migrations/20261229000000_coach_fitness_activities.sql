-- Coach view of Fitness / Fatigue / Form (issue #290, phase 2).
-- One batched, coach-gated read of the per-ride inputs of the load calculation for the signed-in
-- user's ACTIVE athletes (is_coach_of: active, not blocked, evaluated on every call). It returns
-- only load inputs (no title, GPS, streams, files). The thresholds are the ATHLETE's: the stored
-- training_load already uses the athlete's FTP on the ride date, and `lthr` is the athlete's LT2 heart
-- rate snapshot on the ride, else the athlete's lactate threshold history valid on the ride date (UTC day).
-- The coach never joins the raw activities table; there is no new table or policy.
-- Callers page with .range() (the API caps responses at 1000 rows); order is deterministic.

CREATE OR REPLACE FUNCTION public.coach_fitness_activities(
    p_riders UUID[] DEFAULT NULL,
    p_days INTEGER DEFAULT 365
)
RETURNS TABLE (
    rider_id UUID,
    id UUID,
    activity_date TIMESTAMPTZ,
    training_load NUMERIC,
    moving_time_s NUMERIC,
    elapsed_time_s NUMERIC,
    duration_sec NUMERIC,
    avg_hr NUMERIC,
    lthr NUMERIC,
    first_activity_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH riders AS (
        SELECT c.rider_id
        FROM public.coaching_relationships c
        WHERE c.coach_id = auth.uid()
          AND c.status = 'active'
          AND public.is_coach_of(c.rider_id)
          AND (p_riders IS NULL OR c.rider_id = ANY (p_riders))
    )
    SELECT a.user_id,
           a.id,
           a.activity_date,
           a.training_load::NUMERIC,
           a.moving_time_s::NUMERIC,
           a.elapsed_time_s::NUMERIC,
           a.duration_sec::NUMERIC,
           a.avg_hr::NUMERIC,
           COALESCE(
               a.lt2_hr_at_activity,
               (SELECT h.lt2_hr FROM public.lactate_threshold_history h
                 WHERE h.user_id = a.user_id
                   AND h.effective_from <= (a.activity_date AT TIME ZONE 'UTC')::DATE
                 ORDER BY h.effective_from DESC LIMIT 1)
           )::NUMERIC,
           (SELECT MIN(f.activity_date) FROM public.activities f WHERE f.user_id = a.user_id)
    FROM riders r
    JOIN public.activities a ON a.user_id = r.rider_id
    WHERE a.activity_date >= NOW() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 365), 1), 800))
    ORDER BY a.user_id, a.activity_date, a.id
$$;
REVOKE ALL ON FUNCTION public.coach_fitness_activities(UUID[], INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_fitness_activities(UUID[], INTEGER) TO authenticated;
