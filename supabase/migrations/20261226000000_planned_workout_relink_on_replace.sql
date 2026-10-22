-- Planned workouts: keep the "completed" link when an activity is replaced by a better copy.
--
-- Importing a higher-priority copy of a ride (e.g. Intervals.icu replacing a Strava copy) inserts the new
-- activity and deletes the old one. planned_workouts.activity_id is ON DELETE SET NULL, so a planned workout
-- linked to the old copy silently lost its link and showed as "missed" (issue #284).
-- The import calls this function between the insert and the delete to move the link to the replacement.
--
--  * Both activities must belong to the same rider. A signed-in caller must be that rider; the service role
--    (background sync, auth.uid() IS NULL) may act for any rider. No other role can execute it.
--  * Only links that currently point at p_old move, and only when p_new is not already linked elsewhere
--    (an activity completes at most one workout).
--  * Idempotent: replaying it moves nothing. Returns the number of workouts moved.
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
    UPDATE public.planned_workouts w
       SET activity_id = p_new
     WHERE w.activity_id = p_old
       AND w.rider_id = v_old_owner
       AND NOT EXISTS (SELECT 1 FROM public.planned_workouts x WHERE x.activity_id = p_new);
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.planned_workouts_relink_activity(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planned_workouts_relink_activity(UUID, UUID) TO authenticated, service_role;
