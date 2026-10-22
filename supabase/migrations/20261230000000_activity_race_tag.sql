-- VelocityStack: "race" activity tag (issue #294). Idempotent.
--
-- Model (see docs/data-model.md):
--   * activities.is_race         the race tag. Set manually by the rider or the ACTIVE coach, and set
--                                automatically when the activity is linked to a calendar race.
--   * activities.race_tag_auto   TRUE only while the tag exists solely because of a calendar-race link.
--                                Any manual change (set or clear) makes it FALSE, so a manual decision is
--                                never overridden: unlinking removes ONLY an auto-applied tag.
--   * race_set_by / race_set_at / race_set_by_coach   stamp of the last manual change (from auth.uid()).
--                                An auto-tag stamps race_set_at only (no author, not by a coach).
--
-- Writers: the rider (RLS + guard trigger) and the active coach through set_activity_race() only (no
-- coach UPDATE policy on activities). Coach edits are audited in coach_edits and notified like other coach
-- edits. No backfill of old data, except activities already linked to a calendar race (trivial, below).

-- 1. Columns -------------------------------------------------------------------------------
ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS is_race BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS race_tag_auto BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS race_set_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS race_set_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS race_set_by_coach BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_activities_user_race
    ON public.activities (user_id, activity_date DESC) WHERE is_race;

-- 2. Guard trigger: clients cannot forge the auto flag or the stamps -----------------------
-- pg_trigger_depth() > 1 means the change comes from sync_race_tag() below (nested trigger), which
-- sets race_tag_auto itself. Everything else (client writes, set_activity_race) is a manual change.
CREATE OR REPLACE FUNCTION public.guard_activity_race_tag()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.race_tag_auto := FALSE;
        NEW.race_set_by := NULL;
        NEW.race_set_at := NULL;
        NEW.race_set_by_coach := FALSE;
        RETURN NEW;
    END IF;

    IF auth.uid() IS NULL AND pg_trigger_depth() <= 1 THEN
        -- Trusted server-side writer (migration / service role): flags and stamps stand as written.
        NULL;
    ELSIF NEW.is_race IS NOT DISTINCT FROM OLD.is_race THEN
        IF pg_trigger_depth() <= 1 THEN
            NEW.race_tag_auto := OLD.race_tag_auto;
        END IF;
        NEW.race_set_by := OLD.race_set_by;
        NEW.race_set_at := OLD.race_set_at;
        NEW.race_set_by_coach := OLD.race_set_by_coach;
    ELSIF pg_trigger_depth() > 1 THEN
        -- automatic change from a calendar-race link
        NEW.race_set_by := NULL;
        NEW.race_set_at := NOW();
        NEW.race_set_by_coach := FALSE;
    ELSE
        NEW.race_tag_auto := FALSE;
        NEW.race_set_by := auth.uid();
        NEW.race_set_at := NOW();
        NEW.race_set_by_coach := auth.uid() <> OLD.user_id;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_activity_race_tag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_activities_race_tag_guard ON public.activities;
CREATE TRIGGER trg_activities_race_tag_guard
    BEFORE INSERT OR UPDATE ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.guard_activity_race_tag();

-- 3. Auto-tag from calendar races ----------------------------------------------------------
-- Link -> tag the activity (auto, unless it is already tagged: then the existing tag, manual or auto,
-- stays as it was). Unlink / race deleted -> remove the tag ONLY when it is still an auto tag.
-- Skipped for referential actions (depth > 1), e.g. the activity itself being deleted.
CREATE OR REPLACE FUNCTION public.sync_race_tag()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.activity_id IS NOT NULL
       AND (TG_OP = 'DELETE' OR NEW.activity_id IS DISTINCT FROM OLD.activity_id) THEN
        UPDATE public.activities
           SET is_race = FALSE, race_tag_auto = FALSE
         WHERE id = OLD.activity_id AND user_id = OLD.rider_id AND is_race AND race_tag_auto;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.activity_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.activity_id IS DISTINCT FROM OLD.activity_id) THEN
        UPDATE public.activities
           SET is_race = TRUE, race_tag_auto = TRUE
         WHERE id = NEW.activity_id AND user_id = NEW.rider_id AND NOT is_race;
    END IF;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_race_tag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_calendar_races_race_tag ON public.calendar_races;
CREATE TRIGGER trg_calendar_races_race_tag
    AFTER INSERT OR UPDATE OF activity_id OR DELETE ON public.calendar_races
    FOR EACH ROW EXECUTE FUNCTION public.sync_race_tag();

-- 4. The one coach (and rider) write path for the race tag ---------------------------------
CREATE OR REPLACE FUNCTION public.set_activity_race(p_activity UUID, p_is_race BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    a public.activities%ROWTYPE;
    v_new BOOLEAN;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
    IF p_is_race IS NULL THEN RAISE EXCEPTION 'No changes given'; END IF;

    SELECT * INTO a FROM public.activities WHERE id = p_activity FOR UPDATE;
    -- Same answer for "missing" and "not yours / not your athlete's": no probing of foreign ids.
    IF NOT FOUND OR NOT (a.user_id = auth.uid() OR public.is_coach_of(a.user_id)) THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;

    UPDATE public.activities SET is_race = p_is_race WHERE id = p_activity RETURNING is_race INTO v_new;

    IF a.user_id <> auth.uid() AND a.is_race IS DISTINCT FROM v_new THEN
        PERFORM public.record_coach_edit(a.user_id, 'activities', p_activity, 'update',
                                         jsonb_build_object('is_race', a.is_race),
                                         jsonb_build_object('is_race', v_new));
    END IF;
    RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.set_activity_race(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_activity_race(UUID, BOOLEAN) TO authenticated;

-- 5. Trivial backfill: activities already linked to a calendar race ------------------------
-- Runs without a user, so the guard trigger leaves the flags as written (auto tag, no author).
UPDATE public.activities a
   SET is_race = TRUE, race_tag_auto = TRUE, race_set_at = NOW()
  FROM public.calendar_races r
 WHERE r.activity_id = a.id AND r.rider_id = a.user_id AND NOT a.is_race;

-- 6. Masked view: new columns appended at the end ------------------------------------------
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
        a.race_set_by_coach
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
