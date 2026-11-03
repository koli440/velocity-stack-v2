-- Gym session training load (issue #336, model in src/lib/gymLoad.js, design in docs/gym-load.md). Additive and idempotent.
--
-- The model lives in JS, so the value is computed by the app server (src/lib/server/gymLoadStore.js) and STORED:
--   * activities.training_load      the load (same column the fitness chart reads for rides)
--   * activities.gym_load_model     marker: model version that produced training_load. NOT NULL = a model ESTIMATE
--                                   (never a measurement); NULL = no gym estimate (rides, runs, uncomputed gym sessions)
--   * activities.gym_load_at        when it was last scored (NULL = never; set even for sessions without sets, which get no
--                                   estimate). The stored value is never rewritten silently afterwards.
--   * activities.gym_load_stale     the detail was edited since: recomputed on the next open / backfill / save call
--   * gym_load_details              the per-exercise breakdown ("How this was estimated"), readable exactly like the
--                                   gym sets themselves (can_view_gym_detail: rider and active coach); written only by the
--                                   service role.
-- Plus the rider's choice profiles.include_gym_in_fitness (default ON) and the coach fitness RPC carrying the
-- activity type, the estimate marker and that choice, so a coach sees the rider's own setting.

-- 1. Columns ----------------------------------------------------------------------------------
ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS gym_load_model SMALLINT,
    ADD COLUMN IF NOT EXISTS gym_load_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS gym_load_stale BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_activities_gym_load_pending
    ON public.activities (user_id, activity_date)
    WHERE activity_type = 'gym' AND (gym_load_at IS NULL OR gym_load_stale);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS include_gym_in_fitness BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Breakdown table -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gym_load_details (
    activity_id UUID PRIMARY KEY REFERENCES public.activities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    model SMALLINT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT gym_load_details_size_check CHECK (pg_column_size(detail) <= 20000)
);

ALTER TABLE public.gym_load_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gym_load_details FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gym_load_details TO authenticated;
DROP POLICY IF EXISTS "gym_load_details_select" ON public.gym_load_details;
CREATE POLICY "gym_load_details_select" ON public.gym_load_details FOR SELECT TO authenticated
    USING (public.can_view_gym_detail(activity_id));

-- 3. An edit marks the stored load stale -----------------------------------------------------------
-- gym_session_edits is written only by save_gym_session(); the app then recomputes (POST /api/activities/:id/gym-load).
-- If that call never arrives, the next open of the activity or the next backfill picks the stale flag up.
CREATE OR REPLACE FUNCTION public.mark_gym_load_stale()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE public.activities SET gym_load_stale = TRUE WHERE id = NEW.activity_id AND activity_type = 'gym';
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_gym_load_stale() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gym_session_edits_stale_load ON public.gym_session_edits;
CREATE TRIGGER trg_gym_session_edits_stale_load
    AFTER INSERT OR UPDATE ON public.gym_session_edits
    FOR EACH ROW EXECUTE FUNCTION public.mark_gym_load_stale();

-- 4. Masked view: same definition as 20270113000000 with gym_load_model appended (the marker only; the breakdown stays
--    behind can_view_gym_detail).
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
        a.calories,
        a.gym_load_model
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

-- 5. Coach fitness inputs: + activity_type, gym_load_model (estimate marker) and the RIDER's include_gym_in_fitness.
--    Same body and gating as 20270120000000 (active coach only, load inputs only, athlete's thresholds, rides and runs) plus
--    gym sessions that HAVE a model estimate, unless the rider switched include_gym_in_fitness off (then rows are exactly
--    the previous ones).
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
               AND (f.activity_type IN ('ride', 'run')
                    OR (f.activity_type = 'gym' AND f.gym_load_model IS NOT NULL AND COALESCE(p.include_gym_in_fitness, TRUE)))),
           a.activity_type,
           a.gym_load_model,
           COALESCE(p.include_gym_in_fitness, TRUE)
    FROM riders r
    JOIN public.activities a ON a.user_id = r.rider_id
    JOIN public.profiles p ON p.id = a.user_id
    WHERE a.activity_date >= NOW() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 365), 1), 800))
      AND (a.activity_type IN ('ride', 'run')
           OR (a.activity_type = 'gym' AND a.gym_load_model IS NOT NULL AND COALESCE(p.include_gym_in_fitness, TRUE)))
    ORDER BY a.user_id, a.activity_date, a.id
$$;
REVOKE ALL ON FUNCTION public.coach_fitness_activities(UUID[], INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_fitness_activities(UUID[], INTEGER) TO authenticated;
