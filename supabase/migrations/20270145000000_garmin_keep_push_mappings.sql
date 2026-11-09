-- Garmin push: keep the workout/schedule ids when a rider reconnects the SAME Garmin account.
-- Before, the connection trigger deleted every planned_workout_garmin_pushes row on disconnect and when
-- external_athlete_id changed, including NULL -> id on every reconnect (a deregistration webhook nulls it). The
-- workouts stayed in Garmin Connect but we forgot them: the app showed "Not in Garmin" and the next push created
-- duplicates next to the stale ones. Mappings are now only dropped when the account really changes (id -> other id).
-- Disconnecting still turns the automatic push off.
CREATE OR REPLACE FUNCTION public.connections_reset_garmin_planned_push()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.provider <> 'garmin' THEN
        RETURN NEW;
    END IF;
    IF NEW.status = 'disconnected' AND OLD.status IS DISTINCT FROM 'disconnected' THEN
        NEW.push_planned_workouts := FALSE;
        NEW.planned_push_error := NULL;
    END IF;
    IF OLD.external_athlete_id IS NOT NULL AND NEW.external_athlete_id IS NOT NULL
       AND NEW.external_athlete_id IS DISTINCT FROM OLD.external_athlete_id THEN
        NEW.push_planned_workouts := FALSE;
        NEW.planned_push_error := NULL;
        DELETE FROM public.planned_workout_garmin_pushes WHERE rider_id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.connections_reset_garmin_planned_push() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
