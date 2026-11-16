-- Lab: four measurement protocols (docs/lab/measurement-protocols.md): fueling/glucose response, bike-fit log,
-- pedalling efficiency, cadence/torque profile. One owner-scoped table, RPC-only access through lab_gate(), no flag.
-- Glucose readings are health data: only the athlete and their ACTIVE coach can read them; rows cascade with the profile.
CREATE TABLE IF NOT EXISTS public.lab_protocol_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    entered_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    recorded_at DATE NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lab_protocol_entries_kind_ck CHECK (kind IN ('fueling', 'fit', 'pedalling', 'cadence')),
    CONSTRAINT lab_protocol_entries_data_ck CHECK (jsonb_typeof(data) = 'object' AND pg_column_size(data) <= 8000)
);
CREATE INDEX IF NOT EXISTS lab_protocol_entries_athlete_idx ON public.lab_protocol_entries (athlete_id, kind, recorded_at DESC);
ALTER TABLE public.lab_protocol_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_protocol_entries FROM PUBLIC, anon, authenticated;

-- Range-checks an object of numeric fields against {"key":[min,max]}; returns how many known fields were present.
CREATE OR REPLACE FUNCTION public.lab_entry_check_numbers(p_obj JSONB, p_ranges JSONB, p_allow_notes BOOLEAN DEFAULT FALSE)
RETURNS INT
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE k TEXT; v JSONB; n INT := 0;
BEGIN
    FOR k, v IN SELECT * FROM jsonb_each(p_obj) LOOP
        IF p_allow_notes AND k = 'notes' THEN
            IF jsonb_typeof(v) <> 'string' OR length(v #>> '{}') > 500 THEN RAISE EXCEPTION 'Invalid notes'; END IF;
        ELSIF NOT p_ranges ? k OR jsonb_typeof(v) <> 'number'
           OR (v #>> '{}')::numeric NOT BETWEEN (p_ranges->k->>0)::numeric AND (p_ranges->k->>1)::numeric THEN
            RAISE EXCEPTION 'Invalid field %', k;
        ELSE
            n := n + 1;
        END IF;
    END LOOP;
    RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_entry_validate(p_kind TEXT, p_data JSONB)
RETURNS VOID
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
    el JSONB;
    v_arr JSONB;
    v_scalar JSONB;
    v_n INT;
BEGIN
    IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' OR pg_column_size(p_data) > 8000 THEN
        RAISE EXCEPTION 'Invalid data';
    END IF;
    IF p_kind = 'fueling' THEN
        v_arr := p_data -> 'readings';
        IF jsonb_typeof(v_arr) IS DISTINCT FROM 'array' OR jsonb_array_length(v_arr) NOT BETWEEN 2 AND 80 THEN
            RAISE EXCEPTION 'Enter 2 to 80 glucose readings';
        END IF;
        IF p_data->>'session' IS NULL OR p_data->>'session' NOT IN ('fasted', 'fed') THEN
            RAISE EXCEPTION 'Session must be fasted or fed';
        END IF;
        FOR el IN SELECT * FROM jsonb_array_elements(v_arr) LOOP
            IF jsonb_typeof(el) <> 'object' THEN RAISE EXCEPTION 'Invalid reading'; END IF;
            IF public.lab_entry_check_numbers(el, '{"t":[-180,900],"mmol":[1,30]}') <> 2 THEN RAISE EXCEPTION 'Invalid reading'; END IF;
        END LOOP;
        v_scalar := p_data - 'readings' - 'session';
        PERFORM public.lab_entry_check_numbers(v_scalar, '{"carbs_g_per_h":[0,250],"avg_power_w":[0,2500],"duration_min":[1,1200]}', TRUE);
    ELSIF p_kind = 'fit' THEN
        v_n := public.lab_entry_check_numbers(p_data, '{"saddle_height_mm":[500,1000],"setback_mm":[-50,200],"reach_mm":[300,750],"cleat_mm":[-40,40],"crank_mm":[140,185],"avg_power_w":[0,2500],"comfort":[1,5]}', TRUE);
        IF v_n = 0 THEN RAISE EXCEPTION 'Nothing to save'; END IF;
    ELSIF p_kind = 'pedalling' THEN
        v_n := public.lab_entry_check_numbers(p_data, '{"left_balance_pct":[30,70],"te_left":[0,100],"te_right":[0,100],"ps_left":[0,100],"ps_right":[0,100],"avg_power_w":[0,2500]}', TRUE);
        IF v_n = 0 OR NOT (p_data ? 'left_balance_pct' OR p_data ? 'te_left' OR p_data ? 'te_right' OR p_data ? 'ps_left' OR p_data ? 'ps_right') THEN
            RAISE EXCEPTION 'Enter balance, torque effectiveness or smoothness';
        END IF;
    ELSIF p_kind = 'cadence' THEN
        v_arr := p_data -> 'steps';
        IF jsonb_typeof(v_arr) IS DISTINCT FROM 'array' OR jsonb_array_length(v_arr) NOT BETWEEN 2 AND 12 THEN
            RAISE EXCEPTION 'Enter 2 to 12 cadence steps';
        END IF;
        FOR el IN SELECT * FROM jsonb_array_elements(v_arr) LOOP
            IF jsonb_typeof(el) <> 'object' OR NOT (el ? 'rpm' AND el ? 'power_w') THEN RAISE EXCEPTION 'Invalid step'; END IF;
            PERFORM public.lab_entry_check_numbers(el, '{"rpm":[30,200],"power_w":[1,2500],"hr":[30,230]}');
        END LOOP;
        PERFORM public.lab_entry_check_numbers(p_data - 'steps', '{}', TRUE);
    ELSE
        RAISE EXCEPTION 'Unknown protocol';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_entry_save(p_athlete UUID, p_kind TEXT, p_date DATE, p_data JSONB)
RETURNS public.lab_protocol_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.lab_protocol_entries%ROWTYPE;
BEGIN
    PERFORM public.lab_gate(p_athlete);
    IF p_date IS NULL OR p_date NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN
        RAISE EXCEPTION 'Invalid date';
    END IF;
    PERFORM public.lab_entry_validate(p_kind, p_data);
    IF (SELECT count(*) FROM public.lab_protocol_entries WHERE athlete_id = p_athlete AND kind = p_kind) >= 500 THEN
        RAISE EXCEPTION 'Too many entries; delete old ones first';
    END IF;
    INSERT INTO public.lab_protocol_entries (athlete_id, entered_by, kind, recorded_at, data)
    VALUES (p_athlete, auth.uid(), p_kind, p_date, p_data) RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_entry_list(p_athlete UUID, p_kind TEXT DEFAULT NULL)
RETURNS SETOF public.lab_protocol_entries
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM public.lab_gate(p_athlete);
    RETURN QUERY SELECT * FROM public.lab_protocol_entries
        WHERE athlete_id = p_athlete AND (p_kind IS NULL OR kind = p_kind)
        ORDER BY recorded_at DESC, created_at DESC LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_entry_delete(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_athlete UUID;
BEGIN
    SELECT athlete_id INTO v_athlete FROM public.lab_protocol_entries WHERE id = p_id;
    IF v_athlete IS NULL THEN RAISE EXCEPTION 'Not found'; END IF;
    PERFORM public.lab_gate(v_athlete);
    DELETE FROM public.lab_protocol_entries WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.lab_entry_check_numbers(JSONB, JSONB, BOOLEAN), public.lab_entry_validate(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lab_entry_save(UUID, TEXT, DATE, JSONB), public.lab_entry_list(UUID, TEXT), public.lab_entry_delete(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lab_entry_save(UUID, TEXT, DATE, JSONB), public.lab_entry_list(UUID, TEXT), public.lab_entry_delete(UUID) TO authenticated;
