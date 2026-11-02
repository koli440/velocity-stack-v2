-- Reconnecting Intervals.icu through OAuth stores the athlete id as 'i12345'; an API-key connection stored '12345'.
-- The reset trigger saw that as "another athlete" and silently switched the rider's auto-push off and dropped the
-- mappings. Compare ids with the leading 'i' ignored, so only a real athlete change (or a disconnect) resets.
CREATE OR REPLACE FUNCTION public.connections_reset_planned_push()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.provider = 'intervals'
       AND (NEW.status = 'disconnected' AND OLD.status IS DISTINCT FROM 'disconnected'
            OR regexp_replace(COALESCE(NEW.external_athlete_id, ''), '^[iI]', '')
               IS DISTINCT FROM regexp_replace(COALESCE(OLD.external_athlete_id, ''), '^[iI]', '')) THEN
        NEW.push_planned_workouts := FALSE;
        NEW.planned_push_error := NULL;
        DELETE FROM public.planned_workout_pushes WHERE rider_id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.connections_reset_planned_push() FROM PUBLIC, anon, authenticated;
