-- Calendar races (coaching step 4c): a race / event on ONE day of a rider's calendar, so rider and coach see
-- "A race in 6 weeks" when planning (taper, peak).
--
--  * A race belongs to the RIDER's calendar (rider_id), one single day, with a name, discipline
--    (ride | track | other), priority (A = main goal | B | C), optional start time, location, format note
--    and free text notes.
--  * The rider and the rider's ACTIVE, non-blocked coach (is_coach_of, checked per statement so revocation is
--    immediate) can read, add, edit and delete ANY race on that calendar. Nobody else sees or touches them.
--  * Stamps (created_by / updated_by / set_by_coach) come from auth.uid() in a trigger; clients cannot name
--    those columns (column privileges). rider_id is immutable. Races survive the end of coaching and the
--    deletion of the coach account (SET NULL -> "former coach"). Deleting the rider deletes them.
--  * Optional link to a completed activity ("this ride was the race"). The activity must belong to the SAME
--    rider (checked by the trigger, so a coach cannot link anything else, and nobody can probe other users'
--    activities); an activity is linked to at most one race; deleting the activity only clears the link.
--    The "same day" rule is a UI rule (the server has no timezone), like planned workouts.
--  * No notification. Not in realtime publications. All objects are idempotent.

-- 1. Table ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calendar_races (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    race_date DATE NOT NULL,
    race_time TIME,
    name TEXT NOT NULL,
    discipline TEXT NOT NULL DEFAULT 'ride',
    priority TEXT NOT NULL DEFAULT 'B',
    location TEXT NOT NULL DEFAULT '',
    format_note TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    -- TRUE when the race was added by the coach (stays TRUE if the coach account is later deleted).
    set_by_coach BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT calendar_races_name_len CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT calendar_races_discipline CHECK (discipline IN ('ride', 'track', 'other')),
    CONSTRAINT calendar_races_priority CHECK (priority IN ('A', 'B', 'C')),
    CONSTRAINT calendar_races_location_len CHECK (char_length(location) <= 120),
    CONSTRAINT calendar_races_format_len CHECK (char_length(format_note) <= 200),
    CONSTRAINT calendar_races_notes_len CHECK (char_length(notes) <= 1000),
    CONSTRAINT calendar_races_date_range CHECK (race_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31')
);

CREATE INDEX IF NOT EXISTS idx_calendar_races_rider_date
    ON public.calendar_races (rider_id, race_date);

-- An activity is the race of at most one race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_races_activity
    ON public.calendar_races (activity_id) WHERE activity_id IS NOT NULL;

-- 2. Triggers ------------------------------------------------------------------------------
-- SECURITY DEFINER only so it can verify the activity owner (a coach cannot read raw activities).
CREATE OR REPLACE FUNCTION public.calendar_races_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
        -- Referential action (ON DELETE SET NULL of an account / activity): keep everything else.
        RETURN NEW;
    END IF;

    NEW.name := btrim(NEW.name);
    NEW.location := btrim(COALESCE(NEW.location, ''));
    NEW.format_note := btrim(COALESCE(NEW.format_note, ''));
    NEW.notes := btrim(COALESCE(NEW.notes, ''));

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
        -- Bound abuse: at most 10 races per rider and day.
        IF (SELECT count(*) FROM public.calendar_races r
             WHERE r.rider_id = NEW.rider_id AND r.race_date = NEW.race_date) >= 10 THEN
            RAISE EXCEPTION 'Too many races on this day';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
        RAISE EXCEPTION 'A race cannot be moved to another rider';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.set_by_coach := OLD.set_by_coach;
    NEW.updated_by := v_uid;
    NEW.updated_at := NOW();
    IF NEW.race_date IS DISTINCT FROM OLD.race_date
       AND (SELECT count(*) FROM public.calendar_races r
             WHERE r.rider_id = NEW.rider_id AND r.race_date = NEW.race_date) >= 10 THEN
        RAISE EXCEPTION 'Too many races on this day';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calendar_races_stamp ON public.calendar_races;
CREATE TRIGGER trg_calendar_races_stamp
    BEFORE INSERT OR UPDATE ON public.calendar_races
    FOR EACH ROW EXECUTE FUNCTION public.calendar_races_stamp();

REVOKE ALL ON FUNCTION public.calendar_races_stamp() FROM PUBLIC, anon, authenticated;

-- 3. RLS: the rider and the rider's active coach ------------------------------------------
ALTER TABLE public.calendar_races ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calendar_races_select" ON public.calendar_races;
DROP POLICY IF EXISTS "calendar_races_insert" ON public.calendar_races;
DROP POLICY IF EXISTS "calendar_races_update" ON public.calendar_races;
DROP POLICY IF EXISTS "calendar_races_delete" ON public.calendar_races;

CREATE POLICY "calendar_races_select" ON public.calendar_races FOR SELECT TO authenticated
    USING (rider_id = auth.uid() OR public.is_coach_of(rider_id));
CREATE POLICY "calendar_races_insert" ON public.calendar_races FOR INSERT TO authenticated
    WITH CHECK (rider_id = auth.uid() OR public.is_coach_of(rider_id));
CREATE POLICY "calendar_races_update" ON public.calendar_races FOR UPDATE TO authenticated
    USING (rider_id = auth.uid() OR public.is_coach_of(rider_id))
    WITH CHECK (rider_id = auth.uid() OR public.is_coach_of(rider_id));
CREATE POLICY "calendar_races_delete" ON public.calendar_races FOR DELETE TO authenticated
    USING (rider_id = auth.uid() OR public.is_coach_of(rider_id));

-- 4. Privileges: only the writable columns; stamps are not nameable by clients -------------
REVOKE ALL ON public.calendar_races FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.calendar_races TO authenticated;
GRANT INSERT (rider_id, race_date, race_time, name, discipline, priority, location, format_note, notes, activity_id)
    ON public.calendar_races TO authenticated;
GRANT UPDATE (race_date, race_time, name, discipline, priority, location, format_note, notes, activity_id)
    ON public.calendar_races TO authenticated;
