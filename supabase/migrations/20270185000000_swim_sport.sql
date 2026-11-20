-- Swimming (pool and open water) joins the shared sport model.
--  * activities.activity_type also accepts 'swim'; the flavour (pool_swim / open_water_swim) lives in ride_type like
--    the run flavours, and never turns on the gear UI.
--  * coach_fitness_activities returns swims too (same body as 20270124000000, type filter widened), so a coach's
--    Fitness / Fatigue / Form matches the rider's own chart.
-- Additive and idempotent.

INSERT INTO public.ride_types (key, label, has_gear, sort_order) VALUES
    ('pool_swim', 'Pool swim', FALSE, 130),
    ('open_water_swim', 'Open water swim', FALSE, 140)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_activity_type_check
    CHECK (activity_type IN ('ride', 'run', 'swim', 'gym'));

DROP FUNCTION IF EXISTS public.coach_fitness_activities(UUID[], INTEGER);
CREATE FUNCTION public.coach_fitness_activities(
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
    first_activity_at TIMESTAMPTZ,
    activity_type TEXT,
    gym_load_model SMALLINT,
    include_gym BOOLEAN
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
           (SELECT MIN(f.activity_date) FROM public.activities f
             WHERE f.user_id = a.user_id
               AND (f.activity_type IN ('ride', 'run', 'swim')
                    OR (f.activity_type = 'gym' AND f.gym_load_model IS NOT NULL AND COALESCE(p.include_gym_in_fitness, TRUE)))),
           a.activity_type,
           a.gym_load_model,
           COALESCE(p.include_gym_in_fitness, TRUE)
    FROM riders r
    JOIN public.activities a ON a.user_id = r.rider_id
    JOIN public.profiles p ON p.id = a.user_id
    WHERE a.activity_date >= NOW() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 365), 1), 800))
      AND (a.activity_type IN ('ride', 'run', 'swim')
           OR (a.activity_type = 'gym' AND a.gym_load_model IS NOT NULL AND COALESCE(p.include_gym_in_fitness, TRUE)))
    ORDER BY a.user_id, a.activity_date, a.id
$$;
REVOKE ALL ON FUNCTION public.coach_fitness_activities(UUID[], INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_fitness_activities(UUID[], INTEGER) TO authenticated;


NOTIFY pgrst, 'reload schema';
