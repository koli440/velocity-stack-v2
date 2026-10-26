-- Gym session editing (issue #335, builds on #326). Additive and idempotent. Rides are not touched.
--
--  * gym_exercises: notes + name_key (normalised name for grouping / analysis, issue #336).
--  * gym_sets: kind (working / warmup / drop / failure), rest_s, RPE (primary) and RIR (optional), tempo,
--    side (left / right), load_mode (weighted / bodyweight / assisted), notes. Per-set velocity fields
--    (mean_velocity_ms, peak_velocity_ms, velocity_loss_pct, rom_cm) live in the existing `metrics` jsonb.
--    set_type stays 'active' | 'rest' (imports); edited sessions store rest as gym_sets.rest_s.
--  * gym_session_edits: one row per activity whose detail was edited by hand (the "edited" flag; who / when /
--    by a coach). Re-imports and repairs must not replace the detail of an edited session. Written only by
--    save_gym_session(); readable like the sets themselves.
--  * save_gym_session(): the one write path for edits. The rider and the ACTIVE coach (is_coach_of) replace the
--    whole detail of a gym activity atomically. Coach edits are audited in coach_edits and notified like other
--    coach edits. There is still no coach write policy on the gym tables. Missing and foreign activities give
--    the same "Activity not found" answer.

-- 1. Columns -------------------------------------------------------------------------------
ALTER TABLE public.gym_exercises ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.gym_exercises ADD COLUMN IF NOT EXISTS name_key TEXT
    GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) STORED;
ALTER TABLE public.gym_exercises DROP CONSTRAINT IF EXISTS gym_exercises_notes_check;
ALTER TABLE public.gym_exercises ADD CONSTRAINT gym_exercises_notes_check
    CHECK (notes IS NULL OR char_length(notes) <= 1000);
CREATE INDEX IF NOT EXISTS idx_gym_exercises_user_key ON public.gym_exercises (user_id, name_key);

ALTER TABLE public.gym_sets
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'working',
    ADD COLUMN IF NOT EXISTS rest_s NUMERIC,
    ADD COLUMN IF NOT EXISTS rpe NUMERIC,
    ADD COLUMN IF NOT EXISTS rir NUMERIC,
    ADD COLUMN IF NOT EXISTS tempo TEXT,
    ADD COLUMN IF NOT EXISTS side TEXT,
    ADD COLUMN IF NOT EXISTS load_mode TEXT NOT NULL DEFAULT 'weighted',
    ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.gym_sets DROP CONSTRAINT IF EXISTS gym_sets_kind_check;
ALTER TABLE public.gym_sets ADD CONSTRAINT gym_sets_kind_check
    CHECK (kind IN ('working', 'warmup', 'drop', 'failure'));
ALTER TABLE public.gym_sets DROP CONSTRAINT IF EXISTS gym_sets_rest_s_check;
ALTER TABLE public.gym_sets ADD CONSTRAINT gym_sets_rest_s_check
    CHECK (rest_s IS NULL OR (rest_s >= 0 AND rest_s < 86400));
ALTER TABLE public.gym_sets DROP CONSTRAINT IF EXISTS gym_sets_rpe_check;
ALTER TABLE public.gym_sets ADD CONSTRAINT gym_sets_rpe_check
    CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10 AND (rpe * 2) = round(rpe * 2)));
ALTER TABLE public.gym_sets DROP CONSTRAINT IF EXISTS gym_sets_rir_check;
ALTER TABLE public.gym_sets ADD CONSTRAINT gym_sets_rir_check
    CHECK (rir IS NULL OR (rir >= 0 AND rir <= 10 AND (rir * 2) = round(rir * 2)));
ALTER TABLE public.gym_sets DROP CONSTRAINT IF EXISTS gym_sets_tempo_check;
ALTER TABLE public.gym_sets ADD CONSTRAINT gym_sets_tempo_check
    CHECK (tempo IS NULL OR tempo ~ '^[0-9Xx]{1,2}(-[0-9Xx]{1,2}){2,3}$');
ALTER TABLE public.gym_sets DROP CONSTRAINT IF EXISTS gym_sets_side_check;
ALTER TABLE public.gym_sets ADD CONSTRAINT gym_sets_side_check
    CHECK (side IS NULL OR side IN ('left', 'right'));
ALTER TABLE public.gym_sets DROP CONSTRAINT IF EXISTS gym_sets_load_mode_check;
ALTER TABLE public.gym_sets ADD CONSTRAINT gym_sets_load_mode_check
    CHECK (load_mode IN ('weighted', 'bodyweight', 'assisted'));
ALTER TABLE public.gym_sets DROP CONSTRAINT IF EXISTS gym_sets_notes_check;
ALTER TABLE public.gym_sets ADD CONSTRAINT gym_sets_notes_check
    CHECK (notes IS NULL OR char_length(notes) <= 500);
ALTER TABLE public.gym_sets DROP CONSTRAINT IF EXISTS gym_sets_metrics_size_check;
ALTER TABLE public.gym_sets ADD CONSTRAINT gym_sets_metrics_size_check
    CHECK (pg_column_size(metrics) <= 8000);

-- 2. Edited flag + provenance ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gym_session_edits (
    activity_id UUID PRIMARY KEY REFERENCES public.activities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    edited_by_coach BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE public.gym_session_edits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gym_session_edits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gym_session_edits TO authenticated;
DROP POLICY IF EXISTS "gym_session_edits_select" ON public.gym_session_edits;
CREATE POLICY "gym_session_edits_select" ON public.gym_session_edits FOR SELECT TO authenticated
    USING (public.can_view_gym_detail(activity_id));

-- 3. The write path --------------------------------------------------------------------------
-- p_exercises: [{name, category?, subtype?, notes?, sets: [{kind?, reps?, weight_kg?, duration_s?, rest_s?, rpe?,
-- rir?, tempo?, side?, load_mode?, notes?, start_time?, metrics?}]}]. Values are range-checked by the table
-- constraints; unknown keys are ignored. Replaces the whole detail (sets are positioned across the activity).
CREATE OR REPLACE FUNCTION public.save_gym_session(p_activity UUID, p_exercises JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    a public.activities%ROWTYPE;
    ex JSONB;
    s JSONB;
    v_ex_id UUID;
    v_ex_pos INTEGER := 0;
    v_set_pos INTEGER := 0;
    v_old_ex INTEGER;
    v_old_sets INTEGER;
    v_by_coach BOOLEAN;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
    IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array' THEN
        RAISE EXCEPTION 'Exercises must be a list';
    END IF;
    IF jsonb_array_length(p_exercises) > 100 THEN RAISE EXCEPTION 'Too many exercises (max 100)'; END IF;

    SELECT * INTO a FROM public.activities WHERE id = p_activity FOR UPDATE;
    IF NOT FOUND OR NOT (a.user_id = auth.uid() OR public.is_coach_of(a.user_id)) THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;
    IF a.activity_type <> 'gym' THEN RAISE EXCEPTION 'Only gym sessions have exercises and sets'; END IF;
    v_by_coach := a.user_id <> auth.uid();

    SELECT count(*) INTO v_old_ex FROM public.gym_exercises WHERE activity_id = p_activity;
    SELECT count(*) INTO v_old_sets FROM public.gym_sets WHERE activity_id = p_activity AND set_type = 'active';

    DELETE FROM public.gym_exercises WHERE activity_id = p_activity;

    FOR ex IN SELECT value FROM jsonb_array_elements(p_exercises) LOOP
        IF jsonb_typeof(ex) <> 'object' OR jsonb_typeof(COALESCE(ex->'sets', '[]'::jsonb)) <> 'array' THEN
            RAISE EXCEPTION 'Invalid exercise';
        END IF;
        INSERT INTO public.gym_exercises (activity_id, user_id, position, name, category, subtype, notes)
        VALUES (p_activity, a.user_id, v_ex_pos, btrim(ex->>'name'), NULLIF(ex->>'category', ''),
                NULLIF(ex->>'subtype', ''), NULLIF(btrim(COALESCE(ex->>'notes', '')), ''))
        RETURNING id INTO v_ex_id;
        v_ex_pos := v_ex_pos + 1;

        FOR s IN SELECT value FROM jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) LOOP
            IF jsonb_typeof(s) <> 'object' OR jsonb_typeof(COALESCE(s->'metrics', '{}'::jsonb)) <> 'object' THEN
                RAISE EXCEPTION 'Invalid set';
            END IF;
            IF v_set_pos >= 1000 THEN RAISE EXCEPTION 'Too many sets (max 1000)'; END IF;
            INSERT INTO public.gym_sets (activity_id, exercise_id, user_id, position, set_type, start_time,
                                         duration_s, reps, weight_kg, kind, rest_s, rpe, rir, tempo, side,
                                         load_mode, notes, metrics)
            VALUES (p_activity, v_ex_id, a.user_id, v_set_pos, 'active',
                    NULLIF(s->>'start_time', '')::timestamptz,
                    NULLIF(s->>'duration_s', '')::numeric,
                    NULLIF(s->>'reps', '')::integer,
                    NULLIF(s->>'weight_kg', '')::numeric,
                    COALESCE(NULLIF(s->>'kind', ''), 'working'),
                    NULLIF(s->>'rest_s', '')::numeric,
                    NULLIF(s->>'rpe', '')::numeric,
                    NULLIF(s->>'rir', '')::numeric,
                    NULLIF(btrim(COALESCE(s->>'tempo', '')), ''),
                    NULLIF(s->>'side', ''),
                    COALESCE(NULLIF(s->>'load_mode', ''), 'weighted'),
                    NULLIF(btrim(COALESCE(s->>'notes', '')), ''),
                    COALESCE(s->'metrics', '{}'::jsonb));
            v_set_pos := v_set_pos + 1;
        END LOOP;
    END LOOP;

    INSERT INTO public.gym_session_edits (activity_id, user_id, edited_at, edited_by, edited_by_coach)
    VALUES (p_activity, a.user_id, NOW(), auth.uid(), v_by_coach)
    ON CONFLICT (activity_id) DO UPDATE
        SET edited_at = EXCLUDED.edited_at, edited_by = EXCLUDED.edited_by,
            edited_by_coach = EXCLUDED.edited_by_coach;

    -- Imported sets are never searched for again once the rider (or coach) has shaped the detail.
    UPDATE public.activities SET gym_detail_checked_at = COALESCE(gym_detail_checked_at, NOW())
     WHERE id = p_activity;

    IF v_by_coach THEN
        PERFORM public.record_coach_edit(a.user_id, 'gym_sets', p_activity, 'update',
            jsonb_build_object('exercises', v_old_ex, 'sets', v_old_sets),
            jsonb_build_object('exercises', v_ex_pos, 'sets', v_set_pos));
    END IF;

    RETURN jsonb_build_object('exercises', v_ex_pos, 'sets', v_set_pos, 'edited_by_coach', v_by_coach);
END;
$$;
REVOKE ALL ON FUNCTION public.save_gym_session(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_gym_session(UUID, JSONB) TO authenticated;
