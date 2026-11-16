-- Lab: lactate step test (docs/lab/lactate-step-test.md). Private to the athlete and their active coach.
CREATE TABLE IF NOT EXISTS public.lab_lactate_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    test_date DATE NOT NULL,
    steps JSONB NOT NULL,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lab_lactate_steps_ck CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 3 AND 20 AND pg_column_size(steps) <= 8000),
    CONSTRAINT lab_lactate_result_ck CHECK (jsonb_typeof(result) = 'object' AND pg_column_size(result) <= 4000)
);
CREATE INDEX IF NOT EXISTS lab_lactate_tests_athlete_idx ON public.lab_lactate_tests (athlete_id, test_date DESC);
ALTER TABLE public.lab_lactate_tests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_lactate_tests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lab_lactate_save(p_athlete UUID, p_date DATE, p_steps JSONB, p_result JSONB)
RETURNS public.lab_lactate_tests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_row public.lab_lactate_tests%ROWTYPE;
    s JSONB;
BEGIN
    PERFORM public.lab_gate(p_athlete);
    IF p_date IS NULL OR p_date NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN
        RAISE EXCEPTION 'Invalid date';
    END IF;
    IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' OR jsonb_array_length(p_steps) NOT BETWEEN 3 AND 20 THEN
        RAISE EXCEPTION 'A step test needs 3 to 20 steps';
    END IF;
    IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' THEN
        RAISE EXCEPTION 'Invalid result';
    END IF;
    FOR s IN SELECT * FROM jsonb_array_elements(p_steps) LOOP
        IF jsonb_typeof(s) <> 'object'
           OR jsonb_typeof(s->'power') <> 'number' OR (s->>'power')::numeric NOT BETWEEN 1 AND 2500
           OR jsonb_typeof(s->'lactate') <> 'number' OR (s->>'lactate')::numeric NOT BETWEEN 0 AND 30
           OR (s ? 'hr' AND jsonb_typeof(s->'hr') <> 'null' AND (jsonb_typeof(s->'hr') <> 'number' OR (s->>'hr')::numeric NOT BETWEEN 20 AND 260)) THEN
            RAISE EXCEPTION 'Invalid step';
        END IF;
    END LOOP;
    IF pg_column_size(p_steps) > 8000 OR pg_column_size(p_result) > 4000 THEN
        RAISE EXCEPTION 'Test too large';
    END IF;
    INSERT INTO public.lab_lactate_tests (athlete_id, created_by, test_date, steps, result)
    VALUES (p_athlete, auth.uid(), p_date, p_steps, p_result) RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_lactate_list(p_athlete UUID)
RETURNS SETOF public.lab_lactate_tests
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM public.lab_gate(p_athlete);
    RETURN QUERY SELECT * FROM public.lab_lactate_tests WHERE athlete_id = p_athlete ORDER BY test_date DESC, created_at DESC LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_lactate_delete(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_athlete UUID;
BEGIN
    SELECT athlete_id INTO v_athlete FROM public.lab_lactate_tests WHERE id = p_id;
    IF v_athlete IS NULL THEN RAISE EXCEPTION 'Test not found'; END IF;
    PERFORM public.lab_gate(v_athlete);
    DELETE FROM public.lab_lactate_tests WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.lab_lactate_save(UUID, DATE, JSONB, JSONB), public.lab_lactate_list(UUID), public.lab_lactate_delete(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lab_lactate_save(UUID, DATE, JSONB, JSONB), public.lab_lactate_list(UUID), public.lab_lactate_delete(UUID) TO authenticated;
