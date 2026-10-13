-- VelocityStack: GPS privacy zone + restricted view of shared activities (issue #49)
--
-- * profiles.privacy_zone_*: optional per-user circle (e.g. around home). Own-only, never
--   exposed through public_profiles.
-- * activities.route_preview_zone: signature of the zone a persisted route_preview was
--   built with. The shared view only exposes a route_preview whose signature matches the
--   owner's CURRENT zone, so stale/unzoned previews are never shown to other riders.
-- * Other riders no longer read the base `activities` table at all (the shared-select
--   policy is dropped). They read `shared_activities`, a view that:
--     - only returns activities they may see (public, or followers + follow; never across
--       a block),
--     - omits raw_file_url / file_sha256 / ftp_at_activity_w (raw FIT file = full GPS, FTP),
--     - strips latitude/longitude from time_series,
--     - hides route_preview unless it was built with the owner's current privacy zone.
--   Owners keep full access to their own rows through the base table.
-- * Photos' RLS now uses can_view_activity() because other riders can't select from
--   `activities` directly any more.

-- 1. Privacy zone settings ---------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS privacy_zone_lat NUMERIC(8, 5),
    ADD COLUMN IF NOT EXISTS privacy_zone_lng NUMERIC(8, 5),
    ADD COLUMN IF NOT EXISTS privacy_zone_radius_m INTEGER;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_privacy_zone_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_privacy_zone_valid CHECK (
    (privacy_zone_lat IS NULL AND privacy_zone_lng IS NULL AND privacy_zone_radius_m IS NULL)
    OR (
        privacy_zone_lat BETWEEN -90 AND 90
        AND privacy_zone_lng BETWEEN -180 AND 180
        AND privacy_zone_radius_m BETWEEN 50 AND 5000
    )
);

ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS route_preview_zone TEXT;

-- Must match zoneSignature() in src/lib/privacyZone.js.
CREATE OR REPLACE FUNCTION public.zone_signature(p_lat NUMERIC, p_lng NUMERIC, p_radius INTEGER)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_lat IS NULL OR p_lng IS NULL OR p_radius IS NULL THEN 'none'
        ELSE 'z' || round(p_lat, 5)::text || 'x' || round(p_lng, 5)::text || 'x' || p_radius::text
    END
$$;

-- 2. Who may see an activity (owner, public, or followers + follow; never across a block)
CREATE OR REPLACE FUNCTION public.can_view_activity(p_activity UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.activities a
        WHERE a.id = p_activity
          AND (
              a.user_id = auth.uid()
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
              )
          )
    )
$$;

REVOKE ALL ON FUNCTION public.can_view_activity(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_activity(UUID) TO authenticated;

-- 3. Base table: owner only ---------------------------------------------------------------
DROP POLICY IF EXISTS "activities_select_shared" ON public.activities;

-- 4. Restricted view for everyone else ----------------------------------------------------
-- Runs with the view owner's rights (bypasses activities/profiles RLS); the WHERE clause
-- is the access check, and only non-sensitive columns are listed.
DROP VIEW IF EXISTS public.shared_activities;
CREATE VIEW public.shared_activities AS
    SELECT
        a.id,
        a.user_id,
        a.track_id,
        a.title,
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

-- 5. Photos: access follows can_view_activity() --------------------------------------------
DROP POLICY IF EXISTS "activity_photos_select_visible" ON public.activity_photos;
CREATE POLICY "activity_photos_select_visible"
    ON public.activity_photos FOR SELECT
    USING (public.can_view_activity(activity_id));
