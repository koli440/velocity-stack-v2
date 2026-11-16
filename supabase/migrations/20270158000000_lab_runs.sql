-- Lab module, step 1: protocol runner (docs/lab/protocol-runner.md).
--
--  * lab_test_runs: one guided field test (FTP ramp, 20 min, 8 min, CP3/CP12, CP5/CP20) of an athlete.
--    Created by the athlete or their ACTIVE coach (is_coach_of); creating a run plans a workout
--    (planned_workouts, free-form structure DSL) on the athlete's calendar. The result (computed client
--    side from the uploaded ride's power stream) is stored with the activity; applying FTP/zones to the
--    profile still goes through the existing effective-dated history writes (RLS, "set by coach").
--  * Private: only the athlete and their active coach (checked per statement) can read or change a run.
--    No client table privileges; everything via SECURITY DEFINER RPCs behind coach_module_require().
--  * Notification types for the whole Lab module are added once here (one constraint rewrite).
-- All objects idempotent.

-- 1. Notification types (existing list + lab types) -----------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'new_follower', 'follow_request', 'follow_approved',
        'suggestion_submitted', 'suggestion_approved', 'suggestion_rejected',
        'coach_invite', 'coach_request', 'coach_accepted', 'coach_ended', 'coach_replaced',
        'coach_edited',
        'activity_comment', 'comment_mention',
        'activity_reaction',
        'onboarding_submitted', 'coach_note_shared', 'coach_message',
        'licence_reviewed', 'licence_expiring',
        'payment_failed', 'subscription_started', 'subscription_ended',
        'lab_test_planned', 'lab_test_due', 'lab_test_result'
    ));

-- 2. Table -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lab_test_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    protocol TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    planned_date DATE NOT NULL,
    planned_workout_id UUID REFERENCES public.planned_workouts(id) ON DELETE SET NULL,
    activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
    result JSONB,
    applied JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT lab_test_runs_protocol CHECK (protocol IN ('ftp_ramp', 'ftp_20', 'ftp_8', 'cp3_12', 'cp5_20')),
    CONSTRAINT lab_test_runs_status CHECK (status IN ('planned', 'completed', 'applied', 'cancelled')),
    CONSTRAINT lab_test_runs_date_range CHECK (planned_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
    CONSTRAINT lab_test_runs_result_shape CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND pg_column_size(result) <= 8000)),
    CONSTRAINT lab_test_runs_applied_shape CHECK (applied IS NULL OR (jsonb_typeof(applied) = 'object' AND pg_column_size(applied) <= 2000))
);
CREATE INDEX IF NOT EXISTS idx_lab_test_runs_athlete ON public.lab_test_runs (athlete_id, planned_date DESC);

ALTER TABLE public.lab_test_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_test_runs FROM PUBLIC, anon, authenticated;

-- 3. Access helper -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lab_can_access(p_athlete UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT auth.uid() IS NOT NULL AND p_athlete IS NOT NULL
       AND (p_athlete = auth.uid() OR public.is_coach_of(p_athlete))
$$;
REVOKE ALL ON FUNCTION public.lab_can_access(UUID) FROM PUBLIC, anon, authenticated;

-- Athlete-side access: the module flag of the caller, or (own data only) an active coach who has it.
CREATE OR REPLACE FUNCTION public.lab_gate(p_athlete UUID)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT public.lab_can_access(p_athlete) THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;
    IF NOT public.coach_module_enabled(auth.uid())
       AND NOT (p_athlete = auth.uid() AND EXISTS (
            SELECT 1 FROM public.coaching_relationships r
             WHERE r.rider_id = p_athlete AND r.status = 'active' AND public.coach_module_enabled(r.coach_id))) THEN
        RAISE EXCEPTION 'Coach module is not enabled';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.lab_gate(UUID) FROM PUBLIC, anon, authenticated;

-- 4. RPCs --------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lab_run_create(
    p_athlete UUID, p_protocol TEXT, p_date DATE, p_title TEXT, p_description TEXT, p_dsl TEXT, p_manifest JSONB)
RETURNS public.lab_test_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_me UUID := auth.uid();
    v_title TEXT := btrim(COALESCE(p_title, ''));
    v_pw public.planned_workouts%ROWTYPE;
    v_run public.lab_test_runs%ROWTYPE;
BEGIN
    PERFORM public.lab_gate(p_athlete);
    IF p_protocol IS NULL OR p_protocol NOT IN ('ftp_ramp', 'ftp_20', 'ftp_8', 'cp3_12', 'cp5_20') THEN
        RAISE EXCEPTION 'Unknown protocol';
    END IF;
    IF p_date IS NULL OR p_date NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN
        RAISE EXCEPTION 'Invalid date';
    END IF;
    IF char_length(v_title) NOT BETWEEN 1 AND 80 THEN
        RAISE EXCEPTION 'Invalid title';
    END IF;
    IF char_length(COALESCE(p_dsl, '')) > 4000 OR char_length(COALESCE(p_description, '')) > 2000 THEN
        RAISE EXCEPTION 'Workout is too long';
    END IF;
    IF p_dsl IS NULL OR p_manifest IS NULL THEN
        RAISE EXCEPTION 'A test needs its structured workout';
    END IF;
    PERFORM public.planned_workouts_check_structure(p_dsl, p_manifest, v_title);
    INSERT INTO public.planned_workouts (rider_id, workout_date, discipline, title, description, structure_dsl, structure_manifest, source_template_name)
    VALUES (p_athlete, p_date, 'ride', v_title, COALESCE(p_description, ''), p_dsl, p_manifest, v_title)
    RETURNING * INTO v_pw;
    INSERT INTO public.lab_test_runs (athlete_id, created_by, protocol, planned_date, planned_workout_id)
    VALUES (p_athlete, v_me, p_protocol, p_date, v_pw.id)
    RETURNING * INTO v_run;
    IF p_athlete <> v_me THEN
        INSERT INTO public.notifications (user_id, actor_id, type) VALUES (p_athlete, v_me, 'lab_test_planned');
    END IF;
    RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_runs_list(p_athlete UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM public.lab_gate(p_athlete);
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', r.id, 'protocol', r.protocol, 'status', r.status, 'planned_date', r.planned_date,
            'planned_workout_id', r.planned_workout_id, 'activity_id', r.activity_id,
            'activity_title', a.title, 'activity_date', a.activity_date,
            'result', r.result, 'applied', r.applied, 'created_by', r.created_by, 'created_at', r.created_at)
            ORDER BY r.planned_date DESC, r.created_at DESC)
        FROM public.lab_test_runs r
        LEFT JOIN public.activities a ON a.id = r.activity_id AND a.user_id = r.athlete_id
        WHERE r.athlete_id = p_athlete
    ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_run_submit(p_run UUID, p_activity UUID, p_result JSONB)
RETURNS public.lab_test_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_me UUID := auth.uid();
    r public.lab_test_runs%ROWTYPE;
BEGIN
    SELECT * INTO r FROM public.lab_test_runs WHERE id = p_run FOR UPDATE;
    IF NOT FOUND OR NOT public.lab_can_access(r.athlete_id) THEN
        RAISE EXCEPTION 'No such test';
    END IF;
    PERFORM public.lab_gate(r.athlete_id);
    IF r.status NOT IN ('planned', 'completed') THEN
        RAISE EXCEPTION 'This test can no longer be changed';
    END IF;
    IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' OR pg_column_size(p_result) > 8000
       OR p_result->>'protocol' IS DISTINCT FROM r.protocol THEN
        RAISE EXCEPTION 'Invalid result';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.id = p_activity AND a.user_id = r.athlete_id) THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;
    UPDATE public.lab_test_runs
       SET activity_id = p_activity, result = p_result, status = 'completed', updated_at = NOW()
     WHERE id = p_run RETURNING * INTO r;
    -- Tell the coach who planned it when the athlete finished it.
    IF v_me = r.athlete_id AND r.created_by IS NOT NULL AND r.created_by <> v_me THEN
        INSERT INTO public.notifications (user_id, actor_id, type) VALUES (r.created_by, v_me, 'lab_test_result');
    END IF;
    RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_run_mark_applied(p_run UUID, p_applied JSONB)
RETURNS public.lab_test_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    r public.lab_test_runs%ROWTYPE;
BEGIN
    SELECT * INTO r FROM public.lab_test_runs WHERE id = p_run FOR UPDATE;
    IF NOT FOUND OR NOT public.lab_can_access(r.athlete_id) THEN
        RAISE EXCEPTION 'No such test';
    END IF;
    PERFORM public.lab_gate(r.athlete_id);
    IF r.status <> 'completed' THEN
        RAISE EXCEPTION 'Only a completed test can be applied';
    END IF;
    IF p_applied IS NULL OR jsonb_typeof(p_applied) <> 'object' OR pg_column_size(p_applied) > 2000 THEN
        RAISE EXCEPTION 'Invalid applied values';
    END IF;
    UPDATE public.lab_test_runs SET status = 'applied', applied = p_applied, updated_at = NOW()
     WHERE id = p_run RETURNING * INTO r;
    RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_run_cancel(p_run UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    r public.lab_test_runs%ROWTYPE;
BEGIN
    SELECT * INTO r FROM public.lab_test_runs WHERE id = p_run FOR UPDATE;
    IF NOT FOUND OR NOT public.lab_can_access(r.athlete_id) THEN
        RAISE EXCEPTION 'No such test';
    END IF;
    PERFORM public.lab_gate(r.athlete_id);
    IF r.status <> 'planned' THEN
        RAISE EXCEPTION 'Only a planned test can be cancelled';
    END IF;
    UPDATE public.lab_test_runs SET status = 'cancelled', updated_at = NOW() WHERE id = p_run;
    DELETE FROM public.planned_workouts WHERE id = r.planned_workout_id AND activity_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.lab_run_create(UUID, TEXT, DATE, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lab_runs_list(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lab_run_submit(UUID, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lab_run_mark_applied(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lab_run_cancel(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lab_run_create(UUID, TEXT, DATE, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lab_runs_list(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lab_run_submit(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lab_run_mark_applied(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lab_run_cancel(UUID) TO authenticated;
