-- Route map for other riders, honouring the athlete's privacy settings.
--
-- * profiles.route_map_sharing: who may see the GPS route of the athlete's activities, on top of the existing
--   activity visibility (private / followers / public) which still decides who can open the activity at all:
--     'off'       nobody but the owner
--     'coach'     the owner's active coach
--     'followers' coach + followers (DEFAULT: privacy-preserving, strangers on a public activity get no map)
--     'public'    everyone who can view the activity
-- * shared_route_gps(): the ONLY place GPS leaves the owner's row. Returns NULL (no GPS) unless the viewer is allowed,
--   and removes every sample inside the owner's privacy zone (replaced by null, arrays stay index aligned).
--   Untrimmed coordinates are never returned to anyone but the owner.
-- * shared_activities (view): time_series carries the trimmed GPS; route_preview obeys the same setting.
-- Other functions returning a rider's streams (coach_template_run_inputs) keep stripping GPS: they do not need it.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS route_map_sharing TEXT NOT NULL DEFAULT 'followers';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_route_map_sharing_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_route_map_sharing_valid
    CHECK (route_map_sharing IN ('off', 'coach', 'followers', 'public'));

CREATE OR REPLACE FUNCTION public.can_view_route_map(p_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_mode TEXT;
BEGIN
    IF auth.uid() IS NULL OR p_owner IS NULL THEN
        RETURN FALSE;
    END IF;
    IF p_owner = auth.uid() THEN
        RETURN TRUE;
    END IF;
    IF public.is_blocked_between(auth.uid(), p_owner) THEN
        RETURN FALSE;
    END IF;
    SELECT route_map_sharing INTO v_mode FROM public.profiles WHERE id = p_owner;
    IF v_mode IS NULL OR v_mode = 'off' THEN
        RETURN FALSE;
    END IF;
    IF public.is_coach_of(p_owner) THEN
        RETURN TRUE;
    END IF;
    IF v_mode = 'coach' THEN
        RETURN FALSE;
    END IF;
    IF v_mode = 'public' THEN
        RETURN TRUE;
    END IF;
    RETURN EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = auth.uid() AND f.followee_id = p_owner);
END;
$$;
REVOKE ALL ON FUNCTION public.can_view_route_map(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_route_map(UUID) TO authenticated;

-- Pure: samples within the circle (haversine, same maths as privacyZone.js) become null; non-numbers become null.
CREATE OR REPLACE FUNCTION public.trim_gps_to_zone(p_lat JSONB, p_lng JSONB, p_zlat NUMERIC, p_zlng NUMERIC, p_radius INTEGER)
RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    WITH pts AS (
        SELECT la.ord,
               CASE WHEN jsonb_typeof(la.v) = 'number' THEN (la.v #>> '{}')::float8 END AS lat,
               CASE WHEN jsonb_typeof(lo.v) = 'number' THEN (lo.v #>> '{}')::float8 END AS lng
          FROM jsonb_array_elements(p_lat) WITH ORDINALITY AS la(v, ord)
          JOIN jsonb_array_elements(p_lng) WITH ORDINALITY AS lo(v, ord) ON lo.ord = la.ord
    ), flagged AS (
        SELECT ord, lat, lng,
               (lat IS NULL OR lng IS NULL
                OR (p_zlat IS NOT NULL AND p_zlng IS NOT NULL AND p_radius IS NOT NULL
                    AND 2 * 6371000 * asin(least(1, sqrt(
                          power(sin(radians(lat - p_zlat::float8) / 2), 2)
                          + cos(radians(p_zlat::float8)) * cos(radians(lat))
                            * power(sin(radians(lng - p_zlng::float8) / 2), 2)))) <= p_radius)) AS hidden
          FROM pts
    )
    SELECT jsonb_build_object(
        'latitude',  COALESCE(jsonb_agg(CASE WHEN hidden THEN 'null'::jsonb ELSE to_jsonb(lat) END ORDER BY ord), '[]'::jsonb),
        'longitude', COALESCE(jsonb_agg(CASE WHEN hidden THEN 'null'::jsonb ELSE to_jsonb(lng) END ORDER BY ord), '[]'::jsonb))
      FROM flagged
$$;
REVOKE ALL ON FUNCTION public.trim_gps_to_zone(JSONB, JSONB, NUMERIC, NUMERIC, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trim_gps_to_zone(JSONB, JSONB, NUMERIC, NUMERIC, INTEGER) TO authenticated;

-- {latitude, longitude} the current viewer may see, or NULL.
CREATE OR REPLACE FUNCTION public.shared_route_gps(p_owner UUID, p_series JSONB)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    z RECORD;
BEGIN
    IF p_series IS NULL
       OR jsonb_typeof(p_series -> 'latitude') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_series -> 'longitude') IS DISTINCT FROM 'array' THEN
        RETURN NULL;
    END IF;
    IF NOT public.can_view_route_map(p_owner) THEN
        RETURN NULL;
    END IF;
    IF p_owner = auth.uid() THEN
        RETURN jsonb_build_object('latitude', p_series -> 'latitude', 'longitude', p_series -> 'longitude');
    END IF;
    SELECT privacy_zone_lat, privacy_zone_lng, privacy_zone_radius_m INTO z FROM public.profiles WHERE id = p_owner;
    RETURN public.trim_gps_to_zone(p_series -> 'latitude', p_series -> 'longitude', z.privacy_zone_lat, z.privacy_zone_lng, z.privacy_zone_radius_m);
END;
$$;
REVOKE ALL ON FUNCTION public.shared_route_gps(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shared_route_gps(UUID, JSONB) TO authenticated;

-- Same definition as 20270133000000, except time_series (trimmed GPS for allowed viewers) and route_preview.
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
             AND public.can_view_route_map(a.user_id)
            THEN a.route_preview
            ELSE NULL
        END AS route_preview,
        CASE
            WHEN a.time_series IS NULL THEN NULL
            ELSE (a.time_series - 'latitude' - 'longitude')
                 || COALESCE(public.shared_route_gps(a.user_id, a.time_series), '{}'::jsonb)
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
