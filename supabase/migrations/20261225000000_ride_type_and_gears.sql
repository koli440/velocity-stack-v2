-- VelocityStack: ride type (extensible list), several gears per ride and time segments
-- (issue #279). Idempotent; no backfill (existing activities keep ride_type NULL = treated as road).
--
-- Model (see docs/data-model.md):
--   * ride_types              lookup (road, track now; add a row to add a type). Read-only for clients.
--   * activities.ride_type    nullable FK; NULL is treated as the application default 'road'.
--   * activities.gears        jsonb array of {id, chainring, cog, note}; the FIRST entry is the primary gear
--                             and is mirrored into activities.chainring / activities.cog (back-compat).
--   * activities.gear_segments jsonb array of {start_s, end_s, gear_id} (elapsed seconds, ascending, no
--                             overlap); time outside every segment uses the primary gear.
--   * profiles.default_ride_type  applied to new imports / uploads (default 'road').
--
-- Writers: the rider (RLS + the validation/mirroring/stamping trigger below) and the ACTIVE coach, who
-- may change ONLY ride_type / gears / gear_segments, through set_activity_gear(). There is still no
-- coach UPDATE policy on activities. Every coach edit is stamped from auth.uid() (gear_set_*), audited in
-- coach_edits and notified like the other coach edits (20261130000000_coach_edits.sql).

-- 1. Ride type lookup ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ride_types (
    key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,31}$'),
    label TEXT NOT NULL,
    has_gear BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE public.ride_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ride_types_select" ON public.ride_types;
CREATE POLICY "ride_types_select" ON public.ride_types FOR SELECT TO authenticated USING (TRUE);
REVOKE ALL ON public.ride_types FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ride_types TO authenticated;

INSERT INTO public.ride_types (key, label, has_gear, sort_order) VALUES
    ('road', 'Road', FALSE, 10),
    ('track', 'Track', TRUE, 20)
ON CONFLICT (key) DO NOTHING;

-- 2. Columns -------------------------------------------------------------------------------
ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS ride_type TEXT REFERENCES public.ride_types(key) ON UPDATE CASCADE,
    ADD COLUMN IF NOT EXISTS gears JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS gear_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS gear_set_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS gear_set_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS gear_set_by_coach BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS default_ride_type TEXT NOT NULL DEFAULT 'road' REFERENCES public.ride_types(key) ON UPDATE CASCADE;

-- 3. Validation ----------------------------------------------------------------------------
-- Returns an error message, or NULL when gears + segments are valid.
CREATE OR REPLACE FUNCTION public.activity_gears_error(p_gears JSONB, p_segments JSONB)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
    g JSONB;
    s JSONB;
    ids TEXT[] := ARRAY[]::TEXT[];
    gid TEXT;
    prev_end NUMERIC := 0;
    s_start NUMERIC;
    s_end NUMERIC;
BEGIN
    IF p_gears IS NULL OR jsonb_typeof(p_gears) <> 'array' THEN RETURN 'gears must be an array'; END IF;
    IF p_segments IS NULL OR jsonb_typeof(p_segments) <> 'array' THEN RETURN 'gear_segments must be an array'; END IF;
    IF jsonb_array_length(p_gears) > 8 THEN RETURN 'At most 8 gears per ride'; END IF;
    IF jsonb_array_length(p_segments) > 64 THEN RETURN 'At most 64 gear segments per ride'; END IF;

    FOR g IN SELECT * FROM jsonb_array_elements(p_gears) LOOP
        IF jsonb_typeof(g) <> 'object' THEN RETURN 'Invalid gear entry'; END IF;
        gid := g ->> 'id';
        IF gid IS NULL OR gid !~ '^[A-Za-z0-9_-]{1,40}$' THEN RETURN 'Invalid gear id'; END IF;
        IF gid = ANY (ids) THEN RETURN 'Duplicate gear id'; END IF;
        ids := ids || gid;
        IF COALESCE(jsonb_typeof(g -> 'chainring'), '') <> 'number' OR COALESCE(jsonb_typeof(g -> 'cog'), '') <> 'number'
           OR (g ->> 'chainring') !~ '^[0-9]+$' OR (g ->> 'cog') !~ '^[0-9]+$'
           OR (g ->> 'chainring')::INTEGER NOT BETWEEN 8 AND 100
           OR (g ->> 'cog')::INTEGER NOT BETWEEN 8 AND 100 THEN
            RETURN 'Chainring and cog must be whole numbers of teeth (8-100)';
        END IF;
        IF g ? 'note' AND jsonb_typeof(g -> 'note') NOT IN ('string', 'null') THEN RETURN 'Invalid gear note'; END IF;
        IF char_length(COALESCE(g ->> 'note', '')) > 80 THEN RETURN 'Gear note must be at most 80 characters'; END IF;
    END LOOP;

    FOR s IN SELECT * FROM jsonb_array_elements(p_segments) LOOP
        IF jsonb_typeof(s) <> 'object' OR COALESCE(jsonb_typeof(s -> 'start_s'), '') <> 'number'
           OR COALESCE(jsonb_typeof(s -> 'end_s'), '') <> 'number' OR COALESCE(jsonb_typeof(s -> 'gear_id'), '') <> 'string' THEN
            RETURN 'Invalid gear segment';
        END IF;
        s_start := (s ->> 'start_s')::NUMERIC;
        s_end := (s ->> 'end_s')::NUMERIC;
        IF s_start < 0 OR s_end <= s_start OR s_end > 172800 THEN RETURN 'Invalid gear segment range'; END IF;
        IF s_start < prev_end THEN RETURN 'Gear segments must be ascending and not overlap'; END IF;
        IF NOT ((s ->> 'gear_id') = ANY (ids)) THEN RETURN 'Gear segment refers to an unknown gear'; END IF;
        prev_end := s_end;
    END LOOP;
    RETURN NULL;
END;
$$;

-- 4. Guard trigger: validate, mirror the primary gear, stamp -------------------------------
CREATE OR REPLACE FUNCTION public.guard_activity_gears()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    err TEXT;
    changed BOOLEAN;
BEGIN
    err := public.activity_gears_error(NEW.gears, NEW.gear_segments);
    IF err IS NOT NULL THEN RAISE EXCEPTION '%', err; END IF;

    -- The primary (first) gear is mirrored into chainring/cog; with no gear entries the legacy
    -- chainring/cog columns stand on their own (rows written before this feature, direct writers).
    IF jsonb_array_length(NEW.gears) > 0 THEN
        NEW.chainring := (NEW.gears -> 0 ->> 'chainring')::INTEGER;
        NEW.cog := (NEW.gears -> 0 ->> 'cog')::INTEGER;
    ELSIF TG_OP = 'UPDATE' AND OLD.gears <> '[]'::jsonb THEN
        -- all entries removed: no gear anymore
        IF NEW.chainring IS NOT DISTINCT FROM OLD.chainring AND NEW.cog IS NOT DISTINCT FROM OLD.cog THEN
            NEW.chainring := NULL;
            NEW.cog := NULL;
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.gear_set_by := NULL;
        NEW.gear_set_at := NULL;
        NEW.gear_set_by_coach := FALSE;
        RETURN NEW;
    END IF;

    changed := (NEW.ride_type, NEW.gears, NEW.gear_segments, NEW.chainring, NEW.cog)
               IS DISTINCT FROM (OLD.ride_type, OLD.gears, OLD.gear_segments, OLD.chainring, OLD.cog);
    IF changed AND auth.uid() IS NOT NULL THEN
        NEW.gear_set_by := auth.uid();
        NEW.gear_set_at := NOW();
        NEW.gear_set_by_coach := auth.uid() <> OLD.user_id;
    ELSE
        NEW.gear_set_by := OLD.gear_set_by;
        NEW.gear_set_at := OLD.gear_set_at;
        NEW.gear_set_by_coach := OLD.gear_set_by_coach;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activities_gear_guard ON public.activities;
CREATE TRIGGER trg_activities_gear_guard
    BEFORE INSERT OR UPDATE ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.guard_activity_gears();

-- 5. The one coach (and rider) write path for ride type / gears ----------------------------
CREATE OR REPLACE FUNCTION public.set_activity_gear(p_activity UUID, p_changes JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    k TEXT;
    a public.activities%ROWTYPE;
    old_row JSONB;
    new_row JSONB;
    v_type TEXT;
    v_gears JSONB;
    v_segments JSONB;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
    IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
        RAISE EXCEPTION 'No changes given';
    END IF;
    FOR k IN SELECT jsonb_object_keys(p_changes) LOOP
        IF k NOT IN ('ride_type', 'gears', 'gear_segments') THEN
            RAISE EXCEPTION 'Field % cannot be changed here', k;
        END IF;
    END LOOP;

    SELECT * INTO a FROM public.activities WHERE id = p_activity FOR UPDATE;
    -- Same answer for "missing" and "not yours / not your athlete's": no probing of foreign ids.
    IF NOT FOUND OR NOT (a.user_id = auth.uid() OR public.is_coach_of(a.user_id)) THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;

    v_type := CASE WHEN p_changes ? 'ride_type' THEN NULLIF(p_changes ->> 'ride_type', '') ELSE a.ride_type END;
    IF v_type IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ride_types WHERE key = v_type) THEN
        RAISE EXCEPTION 'Unknown ride type';
    END IF;
    v_gears := CASE WHEN p_changes ? 'gears' THEN p_changes -> 'gears' ELSE a.gears END;
    v_segments := CASE WHEN p_changes ? 'gear_segments' THEN p_changes -> 'gear_segments' ELSE a.gear_segments END;

    old_row := jsonb_build_object('ride_type', a.ride_type, 'gears', a.gears, 'gear_segments', a.gear_segments);
    UPDATE public.activities
       SET ride_type = v_type, gears = v_gears, gear_segments = v_segments
     WHERE id = p_activity
    RETURNING jsonb_build_object('ride_type', ride_type, 'gears', gears, 'gear_segments', gear_segments)
      INTO new_row;

    IF a.user_id <> auth.uid() AND new_row IS DISTINCT FROM old_row THEN
        PERFORM public.record_coach_edit(a.user_id, 'activities', p_activity, 'update', old_row, new_row);
    END IF;
    RETURN new_row;
END;
$$;
REVOKE ALL ON FUNCTION public.set_activity_gear(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_activity_gear(UUID, JSONB) TO authenticated;

-- 6. Profile default ride type: a training default a coach may set (like the gear defaults) -
CREATE OR REPLACE FUNCTION public.stamp_profile_training()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.training_set_by := NULL;
        NEW.training_set_at := NULL;
        NEW.training_set_by_coach := FALSE;
    ELSIF (NEW.home_track_id, NEW.default_chainring, NEW.default_cog, NEW.crank_length_mm, NEW.default_ride_type)
          IS DISTINCT FROM (OLD.home_track_id, OLD.default_chainring, OLD.default_cog, OLD.crank_length_mm, OLD.default_ride_type)
          AND auth.uid() IS NOT NULL THEN
        NEW.training_set_by := auth.uid();
        NEW.training_set_at := NOW();
        NEW.training_set_by_coach := auth.uid() <> NEW.id;
    ELSE
        NEW.training_set_by := OLD.training_set_by;
        NEW.training_set_at := OLD.training_set_at;
        NEW.training_set_by_coach := OLD.training_set_by_coach;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.coach_update_athlete_profile(p_rider UUID, p_changes JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    k TEXT;
    old_row JSONB;
    new_row JSONB;
    v_home UUID;
    v_ring INTEGER;
    v_cog INTEGER;
    v_crank NUMERIC;
    v_ride TEXT;
BEGIN
    IF auth.uid() IS NULL OR p_rider IS NULL OR p_rider = auth.uid() OR NOT public.is_coach_of(p_rider) THEN
        RAISE EXCEPTION 'You do not coach this rider';
    END IF;
    IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
        RAISE EXCEPTION 'No changes given';
    END IF;
    FOR k IN SELECT jsonb_object_keys(p_changes) LOOP
        IF k NOT IN ('home_track_id', 'default_chainring', 'default_cog', 'crank_length_mm', 'default_ride_type') THEN
            RAISE EXCEPTION 'Field % cannot be changed by a coach', k;
        END IF;
    END LOOP;

    SELECT jsonb_build_object('home_track_id', p.home_track_id, 'default_chainring', p.default_chainring,
                              'default_cog', p.default_cog, 'crank_length_mm', p.crank_length_mm,
                              'default_ride_type', p.default_ride_type)
      INTO old_row FROM public.profiles p WHERE p.id = p_rider FOR UPDATE;
    IF old_row IS NULL THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;

    v_home := CASE WHEN p_changes ? 'home_track_id' THEN NULLIF(p_changes ->> 'home_track_id', '')::UUID
                   ELSE (old_row ->> 'home_track_id')::UUID END;
    v_ring := CASE WHEN p_changes ? 'default_chainring' THEN NULLIF(p_changes ->> 'default_chainring', '')::INTEGER
                   ELSE (old_row ->> 'default_chainring')::INTEGER END;
    v_cog := CASE WHEN p_changes ? 'default_cog' THEN NULLIF(p_changes ->> 'default_cog', '')::INTEGER
                  ELSE (old_row ->> 'default_cog')::INTEGER END;
    v_crank := CASE WHEN p_changes ? 'crank_length_mm' THEN NULLIF(p_changes ->> 'crank_length_mm', '')::NUMERIC
                    ELSE (old_row ->> 'crank_length_mm')::NUMERIC END;
    v_ride := CASE WHEN p_changes ? 'default_ride_type' THEN COALESCE(NULLIF(p_changes ->> 'default_ride_type', ''), 'road')
                   ELSE old_row ->> 'default_ride_type' END;

    IF v_ring IS NOT NULL AND v_ring NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid chainring'; END IF;
    IF v_cog IS NOT NULL AND v_cog NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid cog'; END IF;
    IF v_crank IS NOT NULL AND v_crank NOT BETWEEN 80 AND 250 THEN RAISE EXCEPTION 'Invalid crank length'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ride_types WHERE key = v_ride) THEN RAISE EXCEPTION 'Unknown ride type'; END IF;

    UPDATE public.profiles
       SET home_track_id = v_home, default_chainring = v_ring, default_cog = v_cog, crank_length_mm = v_crank,
           default_ride_type = v_ride
     WHERE id = p_rider;

    new_row := jsonb_build_object('home_track_id', v_home, 'default_chainring', v_ring,
                                  'default_cog', v_cog, 'crank_length_mm', v_crank,
                                  'default_ride_type', v_ride);
    IF new_row IS DISTINCT FROM old_row THEN
        PERFORM public.record_coach_edit(p_rider, 'profiles', p_rider, 'update', old_row, new_row);
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.coach_update_athlete_profile(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_update_athlete_profile(UUID, JSONB) TO authenticated;

DROP FUNCTION IF EXISTS public.get_athlete_profile(UUID);
CREATE FUNCTION public.get_athlete_profile(p_rider UUID)
RETURNS TABLE (
    id UUID,
    display_name TEXT,
    ftp_w INTEGER,
    home_track_id UUID,
    default_chainring INTEGER,
    default_cog INTEGER,
    crank_length_mm NUMERIC,
    training_set_by UUID,
    training_set_at TIMESTAMPTZ,
    training_set_by_coach BOOLEAN,
    default_ride_type TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.id,
           public.profile_display_name(p.nickname, p.first_name, p.last_name),
           p.ftp_w, p.home_track_id, p.default_chainring, p.default_cog, p.crank_length_mm,
           p.training_set_by, p.training_set_at, p.training_set_by_coach, p.default_ride_type
    FROM public.profiles p
    WHERE p.id = p_rider AND public.is_coach_of(p_rider)
$$;
REVOKE ALL ON FUNCTION public.get_athlete_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_athlete_profile(UUID) TO authenticated;

-- 7. Masked view: new columns appended at the end ------------------------------------------
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
        a.gear_set_by_coach
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
