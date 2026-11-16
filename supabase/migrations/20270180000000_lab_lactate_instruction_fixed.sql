-- The lactate test instruction text is fixed (shown from the app) and not editable by anyone; only the prepared
-- steps (count, length, % of FTP) are coach-editable. The p_instruction argument of lab_lactate_plan_save is kept
-- for compatibility with older clients but ignored; the plan no longer returns an instruction.
UPDATE public.lab_lactate_plans SET instruction = '' WHERE instruction <> '';

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
    IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' OR jsonb_array_length(p_steps) NOT BETWEEN 3 AND 20 THEN
        RAISE EXCEPTION 'A step test needs 3 to 20 steps';
    END IF;
    FOR s IN SELECT * FROM jsonb_array_elements(p_steps) LOOP
        IF jsonb_typeof(s) <> 'object' OR jsonb_typeof(s -> 'pct') <> 'number' OR (s ->> 'pct')::NUMERIC NOT BETWEEN 20 AND 200 THEN
            RAISE EXCEPTION 'Invalid step';
        END IF;
    END LOOP;
    INSERT INTO public.lab_lactate_plans(owner_id, instruction, step_minutes, steps, updated_at)
    VALUES (auth.uid(), '', p_step_minutes, p_steps, NOW())
    ON CONFLICT (owner_id) DO UPDATE
        SET instruction = '', step_minutes = EXCLUDED.step_minutes, steps = EXCLUDED.steps, updated_at = NOW();
END $$;

REVOKE ALL ON FUNCTION public.lab_lactate_plan_get(UUID), public.lab_lactate_plan_save(UUID, TEXT, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lab_lactate_plan_get(UUID), public.lab_lactate_plan_save(UUID, TEXT, INTEGER, JSONB) TO authenticated;
