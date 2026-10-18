-- Planned workouts follow-up: the workout's DSL is now edited in the client (pre-filled from a template at
-- most), so the snapshot is supplied by the caller instead of being copied from analysis_templates.
--
--  * planned_workout_create / planned_workout_set_structure take the DSL text, the manifest parsed from it
--    by the client (same parser as the template editor) and an optional template NAME for display.
--    Nothing reads analysis_templates any more: a coach's template rows can never reach the rider through
--    this feature and the rider's private templates can never reach the coach.
--  * The database cannot run the DSL parser, so it enforces size / shape sanity: DSL <= 4000 chars without
--    control characters, manifest a JSON object <= 20 kB with at most 50 steps of objects, DSL and manifest
--    both present or both absent, name <= 120 chars. The manifest is display data only (summary, match
--    suggestion); nothing executes it.
-- The previous template-id RPCs are dropped. All objects are idempotent.

DROP FUNCTION IF EXISTS public.planned_workout_create(UUID, DATE, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.planned_workout_set_template(UUID, UUID);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'planned_workouts_structure_pair'
                      AND conrelid = 'public.planned_workouts'::regclass) THEN
        ALTER TABLE public.planned_workouts ADD CONSTRAINT planned_workouts_structure_pair
            CHECK ((structure_dsl IS NULL) = (structure_manifest IS NULL)) NOT VALID;
    END IF;
END $$;

-- Raises when the caller-supplied structure is malformed. NULL/NULL (a free-form workout) is valid.
CREATE OR REPLACE FUNCTION public.planned_workouts_check_structure(p_dsl TEXT, p_manifest JSONB, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
    IF p_name IS NOT NULL AND char_length(p_name) > 120 THEN
        RAISE EXCEPTION 'Template name is too long';
    END IF;
    IF p_dsl IS NULL AND p_manifest IS NULL THEN
        RETURN;
    END IF;
    IF p_dsl IS NULL OR p_manifest IS NULL OR btrim(p_dsl) = '' THEN
        RAISE EXCEPTION 'Structure needs both the DSL and its parsed form';
    END IF;
    IF char_length(p_dsl) > 4000 THEN
        RAISE EXCEPTION 'Structure is too long (max 4000 characters)';
    END IF;
    IF p_dsl ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]' THEN
        RAISE EXCEPTION 'Structure contains invalid characters';
    END IF;
    IF jsonb_typeof(p_manifest) <> 'object' OR pg_column_size(p_manifest) > 20000 THEN
        RAISE EXCEPTION 'Invalid structure';
    END IF;
    IF p_manifest ? 'steps' THEN
        IF jsonb_typeof(p_manifest -> 'steps') <> 'array'
           OR jsonb_array_length(p_manifest -> 'steps') > 50
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_manifest -> 'steps') s WHERE jsonb_typeof(s) <> 'object') THEN
            RAISE EXCEPTION 'Invalid structure steps';
        END IF;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.planned_workout_create(
    p_rider UUID, p_date DATE, p_discipline TEXT, p_title TEXT, p_description TEXT DEFAULT '',
    p_dsl TEXT DEFAULT NULL, p_manifest JSONB DEFAULT NULL, p_template_name TEXT DEFAULT NULL)
RETURNS public.planned_workouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_row public.planned_workouts%ROWTYPE;
    v_name TEXT := NULLIF(btrim(COALESCE(p_template_name, '')), '');
BEGIN
    IF NOT public.planned_workouts_can_plan(p_rider) THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;
    PERFORM public.planned_workouts_check_structure(p_dsl, p_manifest, v_name);
    INSERT INTO public.planned_workouts
        (rider_id, workout_date, discipline, title, description,
         structure_dsl, structure_manifest, source_template_name)
    VALUES
        (p_rider, p_date, COALESCE(p_discipline, 'ride'),
         COALESCE(NULLIF(btrim(COALESCE(p_title, '')), ''), CASE WHEN p_dsl IS NULL THEN NULL ELSE left(v_name, 80) END),
         COALESCE(p_description, ''),
         p_dsl, p_manifest, CASE WHEN p_dsl IS NULL THEN NULL ELSE v_name END)
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

-- Replaces the DSL snapshot (p_dsl NULL clears it). The template name is kept only when given.
CREATE OR REPLACE FUNCTION public.planned_workout_set_structure(
    p_id UUID, p_dsl TEXT, p_manifest JSONB, p_template_name TEXT DEFAULT NULL)
RETURNS public.planned_workouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    w public.planned_workouts%ROWTYPE;
    v_name TEXT := NULLIF(btrim(COALESCE(p_template_name, '')), '');
BEGIN
    SELECT * INTO w FROM public.planned_workouts WHERE id = p_id;
    IF NOT FOUND OR NOT public.planned_workouts_can_plan(w.rider_id) THEN
        RAISE EXCEPTION 'Planned workout not found';
    END IF;
    PERFORM public.planned_workouts_check_structure(p_dsl, p_manifest, v_name);
    UPDATE public.planned_workouts
       SET structure_dsl = p_dsl, structure_manifest = p_manifest,
           source_template_name = CASE WHEN p_dsl IS NULL THEN NULL ELSE v_name END
     WHERE id = p_id RETURNING * INTO w;
    RETURN w;
END;
$$;

REVOKE ALL ON FUNCTION public.planned_workouts_check_structure(TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.planned_workout_create(UUID, DATE, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.planned_workout_set_structure(UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planned_workout_create(UUID, DATE, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.planned_workout_set_structure(UUID, TEXT, JSONB, TEXT) TO authenticated;
