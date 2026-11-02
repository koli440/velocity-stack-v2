-- Shared sport model (all providers): runs and ride flavours.
--  * activities.activity_type also accepts 'run' (rides stay the default; gym unchanged).
--  * ride_types gains the detected flavours (mtb, gravel, ebike, indoor, virtual) and the run flavours
--    (run, trail_run, treadmill_run); runs store their flavour in activities.ride_type. Sport flavours are labels
--    only: they never turn on the gear UI.
--  * garmin_activity_events.activity_type keeps the Garmin Appendix A type of each pushed file for the importer.
--  * coach_fitness_activities counts runs as well, so Fitness / Fatigue / Form matches the rider's own chart.
-- Additive and idempotent.

INSERT INTO public.ride_types (key, label, has_gear, sort_order) VALUES
    ('mtb', 'MTB', FALSE, 30),
    ('gravel', 'Gravel', FALSE, 40),
    ('ebike', 'E-bike', FALSE, 50),
    ('indoor', 'Indoor ride', FALSE, 60),
    ('virtual', 'Virtual ride', FALSE, 70),
    ('run', 'Run', FALSE, 100),
    ('trail_run', 'Trail run', FALSE, 110),
    ('treadmill_run', 'Treadmill run', FALSE, 120)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_activity_type_check
    CHECK (activity_type IN ('ride', 'run', 'gym'));

ALTER TABLE public.garmin_activity_events ADD COLUMN IF NOT EXISTS activity_type TEXT;

-- Coach Fitness / Fatigue / Form: rides and runs (same body as 20270113000000, type filter widened).
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
           (SELECT MIN(f.activity_date) FROM public.activities f WHERE f.user_id = a.user_id AND f.activity_type IN ('ride', 'run'))
    FROM riders r
    JOIN public.activities a ON a.user_id = r.rider_id AND a.activity_type IN ('ride', 'run')
    WHERE a.activity_date >= NOW() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 365), 1), 800))
    ORDER BY a.user_id, a.activity_date, a.id
$$;
REVOKE ALL ON FUNCTION public.coach_fitness_activities(UUID[], INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_fitness_activities(UUID[], INTEGER) TO authenticated;
