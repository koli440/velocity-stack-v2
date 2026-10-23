-- Planned workouts: link a new activity to the rider's same-day planned workout automatically.
--
-- Until now the app only SUGGESTED a same-day match. Now the import / upload paths pick the workout (matching
-- logic in src/lib/plannedWorkouts.js, pickAutoLinkCandidate) and call planned_workout_auto_link() to link it.
--
--  * The server has no timezone: "same day" is decided by the caller from the activity's own local date
--    (browser time for uploads, start_date_local from Strava / Intervals.icu for imports) and passed as
--    p_local_date. The function only checks it is plausible (within one day of the activity's UTC date, the
--    maximum UTC offset spread) and that it equals the workout's day.
--  * Never overrides a link, never touches skipped workouts, never steals an activity that is already linked
--    (unique index uq_planned_workouts_activity + row lock). Idempotent: returns FALSE when nothing is linked.
--  * Only recent activities (local date within the last 14 days, at most 1 day ahead) are linked, so a bulk
--    import or a Strava backfill of history never rewrites old plans. Existing activities are not backfilled.
--  * link_source = 'auto' | 'manual' (NULL for links made before this migration, treated as manual).
--  * auto_link_suppressed: set when a user unlinks; that workout is never auto-linked again, so a re-sync or
--    re-import cannot undo the unlink. Applies to every unlink path (RPC or direct update).
--  * An automatic link does not change updated_by / updated_at, so the coach / rider edit stamps stay intact.
--    It sends no notification.
--  * Callable by the rider (their own activity) or the service role (background sync); a coach cannot call it.

ALTER TABLE public.planned_workouts ADD COLUMN IF NOT EXISTS link_source TEXT;
ALTER TABLE public.planned_workouts ADD COLUMN IF NOT EXISTS auto_link_suppressed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.planned_workouts DROP CONSTRAINT IF EXISTS planned_workouts_link_source;
ALTER TABLE public.planned_workouts ADD CONSTRAINT planned_workouts_link_source
    CHECK (link_source IS NULL OR link_source IN ('auto', 'manual'));

-- The stamp trigger (see 20261206000000_planned_workouts.sql) plus link bookkeeping. The transaction-local
-- setting app.planned_link is 'auto' (auto-link function) or 'keep' (relink on replace); anything else is a
-- user change.
CREATE OR REPLACE FUNCTION public.planned_workouts_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_mode TEXT := COALESCE(current_setting('app.planned_link', TRUE), '');
BEGIN
    IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
        -- Referential action (ON DELETE SET NULL of an account / activity): keep everything else.
        RETURN NEW;
    END IF;

    NEW.title := btrim(NEW.title);
    NEW.description := btrim(COALESCE(NEW.description, ''));

    IF NEW.activity_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.activity_id IS DISTINCT FROM OLD.activity_id) THEN
        IF NOT EXISTS (SELECT 1 FROM public.activities a
                        WHERE a.id = NEW.activity_id AND a.user_id = NEW.rider_id) THEN
            RAISE EXCEPTION 'Activity not found';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.created_by := v_uid;
        NEW.updated_by := v_uid;
        NEW.set_by_coach := v_uid IS NOT NULL AND v_uid <> NEW.rider_id;
        NEW.created_at := NOW();
        NEW.updated_at := NOW();
        NEW.link_source := CASE WHEN NEW.activity_id IS NULL THEN NULL ELSE 'manual' END;
        NEW.auto_link_suppressed := FALSE;
        IF (SELECT count(*) FROM public.planned_workouts w
             WHERE w.rider_id = NEW.rider_id AND w.workout_date = NEW.workout_date) >= 20 THEN
            RAISE EXCEPTION 'Too many planned workouts on this day';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
        RAISE EXCEPTION 'A planned workout cannot be moved to another rider';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.set_by_coach := OLD.set_by_coach;
    NEW.updated_by := v_uid;
    NEW.updated_at := NOW();
    IF NEW.workout_date IS DISTINCT FROM OLD.workout_date
       AND (SELECT count(*) FROM public.planned_workouts w
             WHERE w.rider_id = NEW.rider_id AND w.workout_date = NEW.workout_date) >= 20 THEN
        RAISE EXCEPTION 'Too many planned workouts on this day';
    END IF;

    -- Link bookkeeping. Clients cannot choose these two columns.
    NEW.auto_link_suppressed := OLD.auto_link_suppressed;
    NEW.link_source := OLD.link_source;
    IF NEW.activity_id IS DISTINCT FROM OLD.activity_id THEN
        IF v_mode = 'auto' AND OLD.activity_id IS NULL AND NEW.activity_id IS NOT NULL THEN
            NEW.link_source := 'auto';
            NEW.updated_by := OLD.updated_by;
            NEW.updated_at := OLD.updated_at;
        ELSIF v_mode = 'keep' AND OLD.activity_id IS NOT NULL AND NEW.activity_id IS NOT NULL THEN
            NEW.updated_by := OLD.updated_by;
            NEW.updated_at := OLD.updated_at;
        ELSIF NEW.activity_id IS NULL THEN
            NEW.link_source := NULL;
            NEW.auto_link_suppressed := TRUE;
        ELSE
            NEW.link_source := 'manual';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.planned_workouts_stamp() FROM PUBLIC, anon, authenticated;

-- Relink on replace (20261226000000): same function, but the link keeps its source and the edit stamps.
CREATE OR REPLACE FUNCTION public.planned_workouts_relink_activity(p_old UUID, p_new UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_old_owner UUID;
    v_new_owner UUID;
    v_moved INTEGER := 0;
BEGIN
    IF p_old IS NULL OR p_new IS NULL OR p_old = p_new THEN
        RETURN 0;
    END IF;
    SELECT user_id INTO v_old_owner FROM public.activities WHERE id = p_old;
    SELECT user_id INTO v_new_owner FROM public.activities WHERE id = p_new;
    IF v_old_owner IS NULL OR v_new_owner IS NULL OR v_old_owner <> v_new_owner THEN
        RETURN 0;
    END IF;
    IF v_uid IS NOT NULL AND v_uid <> v_old_owner THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;
    PERFORM set_config('app.planned_link', 'keep', TRUE);
    UPDATE public.planned_workouts w
       SET activity_id = p_new
     WHERE w.activity_id = p_old
       AND w.rider_id = v_old_owner
       AND NOT EXISTS (SELECT 1 FROM public.planned_workouts x WHERE x.activity_id = p_new);
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    PERFORM set_config('app.planned_link', '', TRUE);
    RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.planned_workouts_relink_activity(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planned_workouts_relink_activity(UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.planned_workout_auto_link(p_workout UUID, p_activity UUID, p_local_date DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
    a_owner UUID;
    a_date TIMESTAMPTZ;
    w public.planned_workouts%ROWTYPE;
BEGIN
    IF p_workout IS NULL OR p_activity IS NULL OR p_local_date IS NULL THEN
        RETURN FALSE;
    END IF;
    SELECT user_id, activity_date INTO a_owner, a_date FROM public.activities WHERE id = p_activity;
    IF a_owner IS NULL OR (v_uid IS NOT NULL AND v_uid <> a_owner) THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;
    -- Plausible local date: UTC offsets span -12h..+14h, so at most one day from the UTC date; and recent only.
    IF p_local_date < ((a_date AT TIME ZONE 'UTC')::date - 1) OR p_local_date > ((a_date AT TIME ZONE 'UTC')::date + 1)
       OR p_local_date < (CURRENT_DATE - 15) OR p_local_date > (CURRENT_DATE + 1) THEN
        RETURN FALSE;
    END IF;

    SELECT * INTO w FROM public.planned_workouts WHERE id = p_workout AND rider_id = a_owner FOR UPDATE;
    IF NOT FOUND OR w.workout_date <> p_local_date OR w.activity_id IS NOT NULL
       OR w.status <> 'planned' OR w.auto_link_suppressed THEN
        RETURN FALSE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.planned_workouts x WHERE x.activity_id = p_activity) THEN
        RETURN FALSE;
    END IF;

    PERFORM set_config('app.planned_link', 'auto', TRUE);
    BEGIN
        UPDATE public.planned_workouts SET activity_id = p_activity WHERE id = w.id;
    EXCEPTION WHEN unique_violation THEN
        PERFORM set_config('app.planned_link', '', TRUE);
        RETURN FALSE;
    END;
    PERFORM set_config('app.planned_link', '', TRUE);
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.planned_workout_auto_link(UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planned_workout_auto_link(UUID, UUID, DATE) TO authenticated, service_role;
