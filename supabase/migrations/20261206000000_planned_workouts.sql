-- Planned workouts (coaching step 4b): single workouts planned on a rider's calendar, by the rider or
-- by the rider's ACTIVE coach.
--
--  * A planned workout = rider + day + discipline + title + optional notes + an optional SNAPSHOT of a
--    template's structure (DSL source + the compiled manifest), taken server-side when planned. It is a
--    copy, not a live reference: there is no template foreign key and no template id, only the template
--    NAME for display. The coach's source template row and its metadata are never exposed.
--  * Who: the rider and the rider's active coach (is_coach_of, checked per statement, so revocation is
--    immediate) can read, plan, edit, move, skip, link and delete ANY planned workout on that calendar.
--    Followers, strangers, pending / declined / ended / blocked coaches and other riders' coaches get
--    nothing. Not in the feed, public profile or any shared view. No notification.
--  * Templates: planning from a template uses own + system templates of the CALLER only (same rule as
--    coach template runs): a coach can never snapshot the rider's templates, the rider never the coach's.
--  * Stamps (created_by / updated_by / set_by_coach) come from auth.uid() in a trigger; clients cannot
--    name those columns (column privileges). rider_id is immutable. The structure snapshot and the
--    activity link can only be changed through the SECURITY DEFINER functions below.
--  * Completion is derived: activity_id set = completed (the activity must belong to the same rider and
--    can be linked to at most one planned workout). "Missed" is derived in the UI (past + unlinked + not
--    skipped) and never stored.
--  * Workouts survive the end of the relationship and deletion of the coach account (created_by /
--    updated_by -> NULL, set_by_coach stays TRUE -> shown as "former coach"). Deleting the rider deletes
--    them; deleting the linked activity only clears the link. All objects are idempotent.

-- 1. Table ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planned_workouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    workout_date DATE NOT NULL,
    discipline TEXT NOT NULL DEFAULT 'ride',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- Snapshot of the template structure at planning time (NULL = a free-form workout).
    structure_dsl TEXT,
    structure_manifest JSONB,
    source_template_name TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    set_by_coach BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT planned_workouts_title_len CHECK (char_length(title) BETWEEN 1 AND 80),
    CONSTRAINT planned_workouts_description_len CHECK (char_length(description) <= 2000),
    CONSTRAINT planned_workouts_discipline CHECK (discipline IN ('ride', 'track', 'gym', 'other')),
    CONSTRAINT planned_workouts_status CHECK (status IN ('planned', 'skipped')),
    CONSTRAINT planned_workouts_date_range CHECK (workout_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
    CONSTRAINT planned_workouts_dsl_len CHECK (structure_dsl IS NULL OR char_length(structure_dsl) <= 4000),
    CONSTRAINT planned_workouts_manifest_shape CHECK (
        structure_manifest IS NULL
        OR (jsonb_typeof(structure_manifest) = 'object' AND pg_column_size(structure_manifest) <= 20000)),
    CONSTRAINT planned_workouts_template_name_len CHECK (source_template_name IS NULL OR char_length(source_template_name) <= 120),
    -- A completed workout (linked to an activity) is never also "skipped".
    CONSTRAINT planned_workouts_linked_not_skipped CHECK (activity_id IS NULL OR status = 'planned')
);

CREATE INDEX IF NOT EXISTS idx_planned_workouts_rider_date
    ON public.planned_workouts (rider_id, workout_date);
-- An activity completes at most one planned workout.
CREATE UNIQUE INDEX IF NOT EXISTS uq_planned_workouts_activity
    ON public.planned_workouts (activity_id) WHERE activity_id IS NOT NULL;

-- 2. Triggers ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planned_workouts_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
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
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_planned_workouts_stamp ON public.planned_workouts;
CREATE TRIGGER trg_planned_workouts_stamp
    BEFORE INSERT OR UPDATE ON public.planned_workouts
    FOR EACH ROW EXECUTE FUNCTION public.planned_workouts_stamp();

REVOKE ALL ON FUNCTION public.planned_workouts_stamp() FROM PUBLIC, anon, authenticated;

-- 3. RLS: the rider and the rider's active coach ------------------------------------------
ALTER TABLE public.planned_workouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planned_workouts_select" ON public.planned_workouts;
DROP POLICY IF EXISTS "planned_workouts_update" ON public.planned_workouts;
DROP POLICY IF EXISTS "planned_workouts_delete" ON public.planned_workouts;

CREATE POLICY "planned_workouts_select" ON public.planned_workouts FOR SELECT TO authenticated
    USING (rider_id = auth.uid() OR public.is_coach_of(rider_id));
CREATE POLICY "planned_workouts_update" ON public.planned_workouts FOR UPDATE TO authenticated
    USING (rider_id = auth.uid() OR public.is_coach_of(rider_id))
    WITH CHECK (rider_id = auth.uid() OR public.is_coach_of(rider_id));
CREATE POLICY "planned_workouts_delete" ON public.planned_workouts FOR DELETE TO authenticated
    USING (rider_id = auth.uid() OR public.is_coach_of(rider_id));
-- No INSERT policy: workouts are created only through the functions below.

-- 4. Privileges: simple fields are client-writable; structure, link and stamps are not ------
REVOKE ALL ON public.planned_workouts FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.planned_workouts TO authenticated;
GRANT UPDATE (workout_date, discipline, title, description, status) ON public.planned_workouts TO authenticated;

-- 5. Functions (SECURITY DEFINER, pinned search_path, auth.uid() checked) --------------------
-- Caller may touch this rider's calendar (own calendar or active coach).
CREATE OR REPLACE FUNCTION public.planned_workouts_can_plan(p_rider UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT auth.uid() IS NOT NULL AND p_rider IS NOT NULL
       AND (p_rider = auth.uid() OR public.is_coach_of(p_rider))
$$;

-- Plans a workout. With p_template the structure is snapshotted here from one of the CALLER's own
-- templates or a system template (never the rider's / other people's); only the copy is stored.
CREATE OR REPLACE FUNCTION public.planned_workout_create(
    p_rider UUID, p_date DATE, p_discipline TEXT, p_title TEXT,
    p_description TEXT DEFAULT '', p_template UUID DEFAULT NULL)
RETURNS public.planned_workouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
    t public.analysis_templates%ROWTYPE;
    v_title TEXT := btrim(COALESCE(p_title, ''));
    v_row public.planned_workouts%ROWTYPE;
BEGIN
    IF NOT public.planned_workouts_can_plan(p_rider) THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;
    IF p_template IS NOT NULL THEN
        SELECT * INTO t FROM public.analysis_templates
         WHERE id = p_template AND (user_id IS NULL OR user_id = v_uid);
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Template not available';
        END IF;
        IF v_title = '' THEN v_title := left(t.name, 80); END IF;
    END IF;
    INSERT INTO public.planned_workouts
        (rider_id, workout_date, discipline, title, description,
         structure_dsl, structure_manifest, source_template_name)
    VALUES
        (p_rider, p_date, COALESCE(p_discipline, 'ride'), v_title, COALESCE(p_description, ''),
         CASE WHEN p_template IS NULL THEN NULL ELSE t.dsl_source END,
         CASE WHEN p_template IS NULL THEN NULL ELSE t.manifest END,
         CASE WHEN p_template IS NULL THEN NULL ELSE left(t.name, 120) END)
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

-- Replaces the structure snapshot with a (new) template's, or clears it (p_template NULL).
CREATE OR REPLACE FUNCTION public.planned_workout_set_template(p_id UUID, p_template UUID)
RETURNS public.planned_workouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
    w public.planned_workouts%ROWTYPE;
    t public.analysis_templates%ROWTYPE;
BEGIN
    SELECT * INTO w FROM public.planned_workouts WHERE id = p_id;
    IF NOT FOUND OR NOT public.planned_workouts_can_plan(w.rider_id) THEN
        RAISE EXCEPTION 'Planned workout not found';
    END IF;
    IF p_template IS NULL THEN
        UPDATE public.planned_workouts
           SET structure_dsl = NULL, structure_manifest = NULL, source_template_name = NULL
         WHERE id = p_id RETURNING * INTO w;
        RETURN w;
    END IF;
    SELECT * INTO t FROM public.analysis_templates
     WHERE id = p_template AND (user_id IS NULL OR user_id = v_uid);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Template not available';
    END IF;
    UPDATE public.planned_workouts
       SET structure_dsl = t.dsl_source, structure_manifest = t.manifest, source_template_name = left(t.name, 120)
     WHERE id = p_id RETURNING * INTO w;
    RETURN w;
END;
$$;

-- Copies a planned workout (snapshot included) to another day; the copy is a fresh, unlinked workout
-- stamped with the caller.
CREATE OR REPLACE FUNCTION public.planned_workout_duplicate(p_id UUID, p_date DATE)
RETURNS public.planned_workouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    w public.planned_workouts%ROWTYPE;
    v_row public.planned_workouts%ROWTYPE;
BEGIN
    SELECT * INTO w FROM public.planned_workouts WHERE id = p_id;
    IF NOT FOUND OR NOT public.planned_workouts_can_plan(w.rider_id) THEN
        RAISE EXCEPTION 'Planned workout not found';
    END IF;
    INSERT INTO public.planned_workouts
        (rider_id, workout_date, discipline, title, description,
         structure_dsl, structure_manifest, source_template_name)
    VALUES
        (w.rider_id, p_date, w.discipline, w.title, w.description,
         w.structure_dsl, w.structure_manifest, w.source_template_name)
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

-- Links the workout to one of the RIDER's activities (completes it). An activity completes at most one
-- workout and a workout has at most one activity; linking clears "skipped".
CREATE OR REPLACE FUNCTION public.planned_workout_link(p_id UUID, p_activity UUID)
RETURNS public.planned_workouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    w public.planned_workouts%ROWTYPE;
BEGIN
    SELECT * INTO w FROM public.planned_workouts WHERE id = p_id;
    IF NOT FOUND OR NOT public.planned_workouts_can_plan(w.rider_id) THEN
        RAISE EXCEPTION 'Planned workout not found';
    END IF;
    IF p_activity IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.activities a WHERE a.id = p_activity AND a.user_id = w.rider_id) THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;
    BEGIN
        UPDATE public.planned_workouts
           SET activity_id = p_activity, status = 'planned'
         WHERE id = p_id RETURNING * INTO w;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'That activity is already linked to another planned workout';
    END;
    RETURN w;
END;
$$;

CREATE OR REPLACE FUNCTION public.planned_workout_unlink(p_id UUID)
RETURNS public.planned_workouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    w public.planned_workouts%ROWTYPE;
BEGIN
    SELECT * INTO w FROM public.planned_workouts WHERE id = p_id;
    IF NOT FOUND OR NOT public.planned_workouts_can_plan(w.rider_id) THEN
        RAISE EXCEPTION 'Planned workout not found';
    END IF;
    UPDATE public.planned_workouts SET activity_id = NULL WHERE id = p_id RETURNING * INTO w;
    RETURN w;
END;
$$;

REVOKE ALL ON FUNCTION public.planned_workouts_can_plan(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.planned_workout_create(UUID, DATE, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.planned_workout_set_template(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.planned_workout_duplicate(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.planned_workout_link(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.planned_workout_unlink(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planned_workouts_can_plan(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.planned_workout_create(UUID, DATE, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.planned_workout_set_template(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.planned_workout_duplicate(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.planned_workout_link(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.planned_workout_unlink(UUID) TO authenticated;
