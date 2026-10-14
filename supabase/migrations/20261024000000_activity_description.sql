-- Optional free-text description of an activity (issue #96), editable from the ride detail
-- edit modal. Exposed to other riders through the restricted shared_activities view.
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_description_length;
ALTER TABLE public.activities ADD CONSTRAINT activities_description_length
    CHECK (description IS NULL OR char_length(description) <= 2000);

DROP VIEW IF EXISTS public.shared_activities;
CREATE VIEW public.shared_activities AS
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
        END AS time_series
    FROM public.activities a
    JOIN public.profiles p ON p.id = a.user_id
    WHERE a.user_id = auth.uid()
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
