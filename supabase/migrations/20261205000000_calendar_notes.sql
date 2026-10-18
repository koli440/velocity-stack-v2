-- Calendar notes (coaching step 4a): short day notes on a rider's calendar, e.g. "can train Tue/Thu
-- evenings", "ill", "vacation". Visible on the month calendar of the rider and of his ACTIVE coach.
--
--  * A note belongs to the RIDER's calendar (rider_id), one single day, with only a title and text.
--  * The rider and the rider's active coach (is_coach_of) can read, add, edit and delete ANY note on
--    that calendar (including each other's). Nobody else can see or touch them: no followers, no public
--    profile, no feed, no ended/pending/declined/blocked coach (is_coach_of is checked per statement,
--    so revocation is immediate).
--  * Stamps are set by the database only: created_by / updated_by / set_by_coach come from auth.uid(),
--    never from the client (clients cannot even name these columns - column privileges - and a trigger
--    overrides them anyway). A note cannot be moved to another rider.
--  * Notes survive the end of the relationship and the deletion of the coach account
--    (created_by / updated_by become NULL -> shown as "former coach"). Deleting the RIDER deletes them.
--  * No notification. Not in realtime publications. All objects are idempotent.

-- 1. Table ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calendar_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    note_date DATE NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    -- TRUE when the note was written by the coach (stays TRUE if the coach account is later deleted).
    set_by_coach BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT calendar_notes_title_len CHECK (char_length(title) BETWEEN 1 AND 80),
    CONSTRAINT calendar_notes_body_len CHECK (char_length(body) <= 1000),
    CONSTRAINT calendar_notes_date_range CHECK (note_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31')
);

CREATE INDEX IF NOT EXISTS idx_calendar_notes_rider_date
    ON public.calendar_notes (rider_id, note_date);

-- 2. Triggers ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_notes_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.title := btrim(NEW.title);
        NEW.body := btrim(COALESCE(NEW.body, ''));
        NEW.created_by := v_uid;
        NEW.updated_by := v_uid;
        NEW.set_by_coach := v_uid IS NOT NULL AND v_uid <> NEW.rider_id;
        NEW.created_at := NOW();
        NEW.updated_at := NOW();
        -- Bound abuse: at most 20 notes per rider and day.
        IF (SELECT count(*) FROM public.calendar_notes n
             WHERE n.rider_id = NEW.rider_id AND n.note_date = NEW.note_date) >= 20 THEN
            RAISE EXCEPTION 'Too many notes on this day';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE
    IF pg_trigger_depth() > 1 THEN
        -- Referential action (ON DELETE SET NULL of a deleted coach account): keep everything else.
        RETURN NEW;
    END IF;
    IF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
        RAISE EXCEPTION 'A calendar note cannot be moved to another rider';
    END IF;
    NEW.title := btrim(NEW.title);
    NEW.body := btrim(COALESCE(NEW.body, ''));
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.set_by_coach := OLD.set_by_coach;
    NEW.updated_by := v_uid;
    NEW.updated_at := NOW();
    IF NEW.note_date IS DISTINCT FROM OLD.note_date
       AND (SELECT count(*) FROM public.calendar_notes n
             WHERE n.rider_id = NEW.rider_id AND n.note_date = NEW.note_date) >= 20 THEN
        RAISE EXCEPTION 'Too many notes on this day';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calendar_notes_stamp ON public.calendar_notes;
CREATE TRIGGER trg_calendar_notes_stamp
    BEFORE INSERT OR UPDATE ON public.calendar_notes
    FOR EACH ROW EXECUTE FUNCTION public.calendar_notes_stamp();

REVOKE ALL ON FUNCTION public.calendar_notes_stamp() FROM PUBLIC, anon, authenticated;

-- 3. RLS: the rider and the rider's active coach ------------------------------------------
ALTER TABLE public.calendar_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calendar_notes_select" ON public.calendar_notes;
DROP POLICY IF EXISTS "calendar_notes_insert" ON public.calendar_notes;
DROP POLICY IF EXISTS "calendar_notes_update" ON public.calendar_notes;
DROP POLICY IF EXISTS "calendar_notes_delete" ON public.calendar_notes;

CREATE POLICY "calendar_notes_select" ON public.calendar_notes FOR SELECT TO authenticated
    USING (rider_id = auth.uid() OR public.is_coach_of(rider_id));
CREATE POLICY "calendar_notes_insert" ON public.calendar_notes FOR INSERT TO authenticated
    WITH CHECK (rider_id = auth.uid() OR public.is_coach_of(rider_id));
CREATE POLICY "calendar_notes_update" ON public.calendar_notes FOR UPDATE TO authenticated
    USING (rider_id = auth.uid() OR public.is_coach_of(rider_id))
    WITH CHECK (rider_id = auth.uid() OR public.is_coach_of(rider_id));
CREATE POLICY "calendar_notes_delete" ON public.calendar_notes FOR DELETE TO authenticated
    USING (rider_id = auth.uid() OR public.is_coach_of(rider_id));

-- 4. Privileges: only the writable columns; stamps are not nameable by clients -------------
REVOKE ALL ON public.calendar_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.calendar_notes TO authenticated;
GRANT INSERT (rider_id, note_date, title, body) ON public.calendar_notes TO authenticated;
GRANT UPDATE (note_date, title, body) ON public.calendar_notes TO authenticated;
