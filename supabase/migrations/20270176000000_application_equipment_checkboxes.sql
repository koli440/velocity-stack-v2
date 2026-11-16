-- Application equipment is checkboxes only: answers.equipment.items is an array of
-- whitelisted keys. Previously stored free-text answers (power_meter, hr, ... platforms)
-- stay valid so old applications keep rendering.
-- onboarding_validate becomes a wrapper: it validates equipment.items and hands the rest
-- to the original implementation (renamed once, idempotent).

DO $$
BEGIN
    IF to_regprocedure('public.onboarding_validate_base(jsonb,jsonb,boolean,jsonb,uuid)') IS NULL THEN
        ALTER FUNCTION public.onboarding_validate(JSONB, JSONB, BOOLEAN, JSONB, UUID) RENAME TO onboarding_validate_base;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.onboarding_validate(p_answers JSONB, p_health JSONB, p_declined BOOLEAN, p_coach_answers JSONB, p_coach UUID)
RETURNS DATE
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
    v_allowed TEXT[] := ARRAY['power_meter', 'hr_monitor', 'smart_trainer', 'head_unit', 'road_bike', 'tt_bike', 'gravel_bike', 'mtb', 'indoor_bike', 'zwift', 'trainerroad', 'rouvy', 'other'];
    v_eq JSONB;
    v_items JSONB;
    e JSONB;
BEGIN
    IF p_answers IS NOT NULL AND jsonb_typeof(p_answers) = 'object' AND jsonb_typeof(p_answers -> 'equipment') = 'object'
       AND (p_answers -> 'equipment') ? 'items' THEN
        v_items := p_answers -> 'equipment' -> 'items';
        IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) > 20 THEN RAISE EXCEPTION 'Invalid answer: equipment'; END IF;
        FOR e IN SELECT * FROM jsonb_array_elements(v_items) LOOP
            IF jsonb_typeof(e) <> 'string' OR NOT (e #>> '{}') = ANY (v_allowed) THEN RAISE EXCEPTION 'Invalid answer: equipment'; END IF;
        END LOOP;
        v_eq := (p_answers -> 'equipment') - 'items';
        RETURN public.onboarding_validate_base(jsonb_set(p_answers, '{equipment}', v_eq), p_health, p_declined, p_coach_answers, p_coach);
    END IF;
    RETURN public.onboarding_validate_base(p_answers, p_health, p_declined, p_coach_answers, p_coach);
END $$;

REVOKE ALL ON FUNCTION public.onboarding_validate(JSONB, JSONB, BOOLEAN, JSONB, UUID), public.onboarding_validate_base(JSONB, JSONB, BOOLEAN, JSONB, UUID)
    FROM PUBLIC, anon, authenticated;
