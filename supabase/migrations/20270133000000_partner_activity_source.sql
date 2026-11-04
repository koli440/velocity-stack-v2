-- Source badges for partner-app activities.
-- 1) shared_activities gets import_source (appended column; same definition as 20270124000000 otherwise):
--    'partner:<app slug>' for partner uploads, otherwise the plain source ('strava', 'garmin', ...). No external ids.
-- 2) Riders may read the public identity (name, slug) of APPROVED apps, to label badges. Token/secret columns
--    stay ungranted (column grants from 20270129000000).

CREATE OR REPLACE VIEW public.shared_activities AS
    SELECT
        a.id, a.user_id, a.track_id, a.title, a.description, a.activity_date, a.created_at, a.chainring, a.cog,
        a.crank_length_mm, a.distance_m, a.max_cadence_rpm, a.max_speed_kmh, a.max_power_w, a.peak_torque_nm,
        a.start_time, a.elapsed_time_s, a.moving_time_s, a.avg_speed_kmh, a.avg_power_w, a.normalized_power_w,
        a.avg_cadence_rpm, a.avg_torque_nm, a.avg_hr, a.max_hr, a.elevation_gain_m, a.elevation_loss_m,
        a.intensity_factor, a.training_load, a.speed_source, a.bike_model, a.handlebar_setup, a.helmet,
        a.perceived_exertion, a.curves_data, a.processing_status, a.visibility, a.badges,
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
        a.power_preview, a.ride_type, a.gears, a.gear_segments, a.gear_set_by, a.gear_set_at, a.gear_set_by_coach,
        a.is_race, a.race_tag_auto, a.race_set_by, a.race_set_at, a.race_set_by_coach, a.activity_type, a.calories,
        a.gym_load_model,
        CASE WHEN a.external_source LIKE 'partner:%' THEN a.external_source ELSE a.source END AS import_source
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

DROP POLICY IF EXISTS developer_apps_approved_read ON public.developer_apps;
CREATE POLICY developer_apps_approved_read ON public.developer_apps FOR SELECT TO authenticated USING (status = 'approved');
