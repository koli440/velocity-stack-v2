-- Lactate step test: instruction text and prepared steps, editable by the coach.
-- One plan per owner (a coach, or a rider without a coach plan). The client falls back to
-- built-in defaults when no plan row exists. Steps are % of FTP plus a step length.

CREATE TABLE IF NOT EXISTS public.lab_lactate_plans (
    owner_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    instruction TEXT NOT NULL DEFAULT '' CHECK (char_length(instruction) <= 3000),
    step_minutes INTEGER NOT NULL DEFAULT 4 CHECK (step_minutes BETWEEN 1 AND 20),
    steps JSONB NOT NULL DEFAULT '[]'::JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.lab_lactate_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_lactate_plans FROM PUBLIC, anon, authenticated;

-- Plan owner for a viewer: a coach edits and uses their own plan; a rider uses their active coach's plan if any, else their own.
CREATE OR REPLACE FUNCTION public.lab_lactate_plan_owner(p_athlete UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE
        WHEN auth.uid() <> p_athlete THEN auth.uid()
        ELSE COALESCE((
            SELECT r.coach_id FROM public.coaching_relationships r
              JOIN public.lab_lactate_plans p ON p.owner_id = r.coach_id
             WHERE r.rider_id = p_athlete AND r.status = 'active' LIMIT 1), auth.uid())
    END
$$;
REVOKE ALL ON FUNCTION public.lab_lactate_plan_owner(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lab_lactate_plan_get(p_athlete UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_owner UUID;
    v_row public.lab_lactate_plans%ROWTYPE;
BEGIN
    PERFORM public.lab_gate(p_athlete);
    v_owner := public.lab_lactate_plan_owner(p_athlete);
    SELECT * INTO v_row FROM public.lab_lactate_plans WHERE owner_id = v_owner;
    RETURN jsonb_build_object(
        'custom', FOUND,
        'from_coach', v_owner <> auth.uid(),
        'editable', v_owner = auth.uid(),
        'instruction', CASE WHEN FOUND THEN v_row.instruction END,
        'step_minutes', CASE WHEN FOUND THEN v_row.step_minutes END,
        'steps', CASE WHEN FOUND THEN v_row.steps END);
END $$;

CREATE OR REPLACE FUNCTION public.lab_lactate_plan_save(p_athlete UUID, p_instruction TEXT, p_step_minutes INTEGER, p_steps JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    s JSONB;
BEGIN
    PERFORM public.lab_gate(p_athlete);
    IF public.lab_lactate_plan_owner(p_athlete) <> auth.uid() THEN
        RAISE EXCEPTION 'Your coach manages this plan';
    END IF;
    IF p_step_minutes IS NULL OR p_step_minutes NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Invalid step length'; END IF;
    IF char_length(COALESCE(p_instruction, '')) > 3000 THEN RAISE EXCEPTION 'Instruction is too long'; END IF;
    IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' OR jsonb_array_length(p_steps) NOT BETWEEN 3 AND 20 THEN
        RAISE EXCEPTION 'A step test needs 3 to 20 steps';
    END IF;
    FOR s IN SELECT * FROM jsonb_array_elements(p_steps) LOOP
        IF jsonb_typeof(s) <> 'object' OR jsonb_typeof(s -> 'pct') <> 'number' OR (s ->> 'pct')::NUMERIC NOT BETWEEN 20 AND 200 THEN
            RAISE EXCEPTION 'Invalid step';
        END IF;
    END LOOP;
    INSERT INTO public.lab_lactate_plans(owner_id, instruction, step_minutes, steps, updated_at)
    VALUES (auth.uid(), COALESCE(p_instruction, ''), p_step_minutes, p_steps, NOW())
    ON CONFLICT (owner_id) DO UPDATE
        SET instruction = EXCLUDED.instruction, step_minutes = EXCLUDED.step_minutes, steps = EXCLUDED.steps, updated_at = NOW();
END $$;

CREATE OR REPLACE FUNCTION public.lab_lactate_plan_reset(p_athlete UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM public.lab_gate(p_athlete);
    IF public.lab_lactate_plan_owner(p_athlete) <> auth.uid() THEN
        RAISE EXCEPTION 'Your coach manages this plan';
    END IF;
    DELETE FROM public.lab_lactate_plans WHERE owner_id = auth.uid();
END $$;

REVOKE ALL ON FUNCTION public.lab_lactate_plan_get(UUID), public.lab_lactate_plan_save(UUID, TEXT, INTEGER, JSONB), public.lab_lactate_plan_reset(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lab_lactate_plan_get(UUID), public.lab_lactate_plan_save(UUID, TEXT, INTEGER, JSONB), public.lab_lactate_plan_reset(UUID) TO authenticated;
