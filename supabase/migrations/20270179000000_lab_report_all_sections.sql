-- Lab reports: every Lab module can be a report section (docs/lab/reports.md), and the athlete's age feeds the
-- phenotype calculation. Additive: a nullable birth year on profiles, an age RPC, and a wider lab_report_create whitelist.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birth_year SMALLINT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_birth_year_ck') THEN
        ALTER TABLE public.profiles ADD CONSTRAINT profiles_birth_year_ck CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100);
    END IF;
END $$;

-- Age in whole years (calendar-year based) for the Lab; only the age is exposed, never the birth year.
CREATE OR REPLACE FUNCTION public.lab_athlete_age(p_athlete UUID)
RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_year SMALLINT;
BEGIN
    PERFORM public.lab_gate(p_athlete);
    SELECT birth_year INTO v_year FROM public.profiles WHERE id = p_athlete;
    IF v_year IS NULL OR v_year > extract(year FROM now())::int THEN RETURN NULL; END IF;
    RETURN extract(year FROM now())::int - v_year;
END;
$$;
REVOKE ALL ON FUNCTION public.lab_athlete_age(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lab_athlete_age(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.lab_report_create(p_athlete UUID, p_title TEXT, p_note TEXT, p_snapshot JSONB)
RETURNS public.lab_reports
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_row public.lab_reports%ROWTYPE;
    k TEXT;
BEGIN
    PERFORM public.lab_gate(p_athlete);
    p_title := btrim(COALESCE(p_title, ''));
    p_note := btrim(COALESCE(p_note, ''));
    IF char_length(p_title) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Title must be 1 to 80 characters'; END IF;
    IF char_length(p_note) > 300 THEN RAISE EXCEPTION 'Note is limited to 300 characters'; END IF;
    IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR pg_column_size(p_snapshot) > 24000 THEN
        RAISE EXCEPTION 'Invalid report content';
    END IF;
    FOR k IN SELECT jsonb_object_keys(p_snapshot) LOOP
        IF k NOT IN ('thresholds', 'phenotype', 'tests', 'forms', 'lactate', 'durability', 'decoupling', 'aero', 'fueling', 'fit', 'pedalling', 'cadence') THEN
            RAISE EXCEPTION 'Unknown section %', k;
        END IF;
        IF k IN ('tests', 'durability', 'decoupling', 'aero', 'fueling') THEN
            IF jsonb_typeof(p_snapshot->k) <> 'array' OR jsonb_array_length(p_snapshot->k) > 20 THEN
                RAISE EXCEPTION 'Invalid % section', k;
            END IF;
        ELSIF jsonb_typeof(p_snapshot->k) <> 'object' THEN
            RAISE EXCEPTION 'Invalid % section', k;
        END IF;
    END LOOP;
    IF (p_snapshot ? 'forms' OR p_snapshot ? 'fueling') AND auth.uid() <> p_athlete THEN
        RAISE EXCEPTION 'Only the athlete can share health data';
    END IF;
    IF (SELECT count(*) FROM public.lab_reports WHERE athlete_id = p_athlete AND revoked_at IS NULL) >= 20 THEN
        RAISE EXCEPTION 'Too many active reports; revoke one first';
    END IF;
    INSERT INTO public.lab_reports (athlete_id, created_by, token, title, note, snapshot)
    VALUES (p_athlete, auth.uid(), replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), p_title, p_note, p_snapshot)
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.lab_report_create(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lab_report_create(UUID, TEXT, TEXT, JSONB) TO authenticated;
