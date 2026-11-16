-- Lab: field protocol forms (docs/lab/field-forms.md): body composition, mobility checklist, sprint test.
-- Private to the athlete and their active coach; no flag; RPC-only access through lab_gate().
CREATE TABLE IF NOT EXISTS public.lab_field_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    entered_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    recorded_at DATE NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lab_field_kind_ck CHECK (kind IN ('body', 'mobility', 'sprint')),
    CONSTRAINT lab_field_data_ck CHECK (jsonb_typeof(data) = 'object' AND pg_column_size(data) <= 2000)
);
CREATE INDEX IF NOT EXISTS lab_field_results_athlete_idx ON public.lab_field_results (athlete_id, kind, recorded_at DESC);
ALTER TABLE public.lab_field_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_field_results FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lab_field_save(p_athlete UUID, p_kind TEXT, p_date DATE, p_data JSONB)
RETURNS public.lab_field_results
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_row public.lab_field_results%ROWTYPE;
    v_ranges JSONB;
    k TEXT;
    v JSONB;
    v_n INT := 0;
BEGIN
    PERFORM public.lab_gate(p_athlete);
    IF p_date IS NULL OR p_date NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN
        RAISE EXCEPTION 'Invalid date';
    END IF;
    IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' OR pg_column_size(p_data) > 2000 THEN
        RAISE EXCEPTION 'Invalid data';
    END IF;
    IF p_kind = 'body' THEN
        v_ranges := '{"weight_kg":[20,300],"body_fat_pct":[2,60],"waist_cm":[30,250],"hip_cm":[30,250],"chest_cm":[30,250],"thigh_cm":[10,120]}';
    ELSIF p_kind = 'sprint' THEN
        v_ranges := '{"distance_m":[10,1000],"time_s":[0.5,120],"peak_power_w":[1,3500]}';
    ELSIF p_kind = 'mobility' THEN
        v_ranges := NULL;
    ELSE
        RAISE EXCEPTION 'Unknown test kind';
    END IF;

    FOR k, v IN SELECT * FROM jsonb_each(p_data) LOOP
        IF k = 'notes' THEN
            IF jsonb_typeof(v) <> 'string' OR length(v #>> '{}') > 500 THEN RAISE EXCEPTION 'Invalid notes'; END IF;
        ELSIF p_kind = 'mobility' THEN
            IF k !~ '^[a-z_]{2,30}$' OR jsonb_typeof(v) <> 'string' OR (v #>> '{}') NOT IN ('pass', 'limited') THEN
                RAISE EXCEPTION 'Invalid mobility item';
            END IF;
            v_n := v_n + 1;
        ELSE
            IF NOT v_ranges ? k OR jsonb_typeof(v) <> 'number'
               OR (v #>> '{}')::numeric NOT BETWEEN (v_ranges->k->>0)::numeric AND (v_ranges->k->>1)::numeric THEN
                RAISE EXCEPTION 'Invalid field %', k;
            END IF;
            v_n := v_n + 1;
        END IF;
    END LOOP;
    IF v_n = 0 THEN RAISE EXCEPTION 'Nothing to save'; END IF;
    IF p_kind = 'sprint' AND NOT (p_data ? 'distance_m' AND p_data ? 'time_s') THEN
        RAISE EXCEPTION 'A sprint needs distance and time';
    END IF;

    INSERT INTO public.lab_field_results (athlete_id, entered_by, kind, recorded_at, data)
    VALUES (p_athlete, auth.uid(), p_kind, p_date, p_data) RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_field_list(p_athlete UUID, p_kind TEXT DEFAULT NULL)
RETURNS SETOF public.lab_field_results
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM public.lab_gate(p_athlete);
    RETURN QUERY SELECT * FROM public.lab_field_results
        WHERE athlete_id = p_athlete AND (p_kind IS NULL OR kind = p_kind)
        ORDER BY recorded_at DESC, created_at DESC LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_field_delete(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_athlete UUID;
BEGIN
    SELECT athlete_id INTO v_athlete FROM public.lab_field_results WHERE id = p_id;
    IF v_athlete IS NULL THEN RAISE EXCEPTION 'Not found'; END IF;
    PERFORM public.lab_gate(v_athlete);
    DELETE FROM public.lab_field_results WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.lab_field_save(UUID, TEXT, DATE, JSONB), public.lab_field_list(UUID, TEXT), public.lab_field_delete(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lab_field_save(UUID, TEXT, DATE, JSONB), public.lab_field_list(UUID, TEXT), public.lab_field_delete(UUID) TO authenticated;
