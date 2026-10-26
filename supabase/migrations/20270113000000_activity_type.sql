-- Activity type (issue #326, layer 1): rides stay the default, gym / strength sessions become importable.
--
--  * activities.activity_type: 'ride' (default; every existing row) | 'gym'. Additive and idempotent.
--  * activities.calories (kcal): optional, filled by sources that report it (gym sessions mainly).
--  * Ride-only readers keep ride-only semantics: coach_fitness_activities skips gym sessions, so a
--    coach's Fitness / Fatigue / Form is unchanged. Gym sessions carry no power curves (no
--    activity_curves rows), so personal bests, baselines and power profiles are not affected either.
--  * The masked shared_activities view exposes both new columns (appended at the end).
--  * Exercises / sets detail tables follow in layer 2.

ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS activity_type TEXT NOT NULL DEFAULT 'ride';
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS calories NUMERIC;

ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_activity_type_check
    CHECK (activity_type IN ('ride', 'gym'));
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_calories_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_calories_check
    CHECK (calories IS NULL OR (calories >= 0 AND calories < 100000));

CREATE INDEX IF NOT EXISTS idx_activities_user_type_date
    ON public.activities (user_id, activity_type, activity_date DESC);

-- Coach Fitness / Fatigue / Form: rides only (same body as 20261229000000 plus the type filter).
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
           (SELECT MIN(f.activity_date) FROM public.activities f WHERE f.user_id = a.user_id AND f.activity_type = 'ride')
    FROM riders r
    JOIN public.activities a ON a.user_id = r.rider_id AND a.activity_type = 'ride'
    WHERE a.activity_date >= NOW() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 365), 1), 800))
    ORDER BY a.user_id, a.activity_date, a.id
$$;
REVOKE ALL ON FUNCTION public.coach_fitness_activities(UUID[], INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_fitness_activities(UUID[], INTEGER) TO authenticated;

-- Masked view: same definition as 20261230000000 with activity_type and calories appended.
CREATE OR REPLACE VIEW public.shared_activities AS
    SELECT
        a.id,
        a.user_id,
        a.track_id,
        a.title,
        a.description,
        a.activity_date,
        a.created_at,
        a.chainring,
        a.cog,
        a.crank_length_mm,
        a.distance_m,
        a.max_cadence_rpm,
        a.max_speed_kmh,
        a.max_power_w,
        a.peak_torque_nm,
        a.start_time,
        a.elapsed_time_s,
        a.moving_time_s,
        a.avg_speed_kmh,
        a.avg_power_w,
        a.normalized_power_w,
        a.avg_cadence_rpm,
        a.avg_torque_nm,
        a.avg_hr,
        a.max_hr,
        a.elevation_gain_m,
        a.elevation_loss_m,
        a.intensity_factor,
        a.training_load,
        a.speed_source,
        a.bike_model,
        a.handlebar_setup,
        a.helmet,
        a.perceived_exertion,
        a.curves_data,
        a.processing_status,
        a.visibility,
        a.badges,
        (SELECT jsonb_build_object('name', t.name, 'length_m', t.length_m, 'surface', t.surface)
           FROM public.tracks t WHERE t.id = a.track_id) AS tracks,
        CASE
            WHEN COALESCE(a.route_preview_zone, 'none') =
                 public.zone_signature(p.privacy_zone_lat, p.privacy_zone_lng, p.privacy_zone_radius_m)
            THEN a.route_preview
            ELSE NULL
        END AS route_preview,
        CASE
            WHEN a.time_series IS NULL THEN NULL
            ELSE (a.time_series - 'latitude' - 'longitude')
        END AS time_series,
        a.power_preview,
        a.ride_type,
        a.gears,
        a.gear_segments,
        a.gear_set_by,
        a.gear_set_at,
        a.gear_set_by_coach,
        a.is_race,
        a.race_tag_auto,
        a.race_set_by,
        a.race_set_at,
        a.race_set_by_coach,
        a.activity_type,
        a.calories
    FROM public.activities a
    JOIN public.profiles p ON p.id = a.user_id
    WHERE a.user_id = auth.uid()
       OR public.is_coach_of(a.user_id)
       OR (
            NOT public.is_blocked_between(auth.uid(), a.user_id)
            AND (
                a.visibility = 'public'
                OR (
                    a.visibility = 'followers'
                    AND EXISTS (
                        SELECT 1 FROM public.follows f
                        WHERE f.follower_id = auth.uid() AND f.followee_id = a.user_id
                    )
                )
            )
       );

REVOKE ALL ON public.shared_activities FROM PUBLIC, anon;
GRANT SELECT ON public.shared_activities TO authenticated;
