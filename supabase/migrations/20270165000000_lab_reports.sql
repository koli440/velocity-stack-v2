-- Lab: branded shareable report (docs/lab/reports.md). A report is a frozen snapshot of the sections the creator chose,
-- opened through an unguessable token. Creation/listing/revocation go through lab_gate (athlete or active coach, no flag);
-- only lab_report_public is anon-callable. Health-like data (body composition) can only be shared by the athlete themselves.
CREATE TABLE IF NOT EXISTS public.lab_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    CONSTRAINT lab_reports_title_ck CHECK (char_length(title) BETWEEN 1 AND 80),
    CONSTRAINT lab_reports_note_ck CHECK (char_length(note) <= 300),
    CONSTRAINT lab_reports_snapshot_ck CHECK (jsonb_typeof(snapshot) = 'object' AND pg_column_size(snapshot) <= 6000)
);
CREATE INDEX IF NOT EXISTS lab_reports_athlete_idx ON public.lab_reports (athlete_id, created_at DESC);
ALTER TABLE public.lab_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_reports FROM PUBLIC, anon, authenticated;

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
    IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR pg_column_size(p_snapshot) > 6000 THEN
        RAISE EXCEPTION 'Invalid report content';
    END IF;
    FOR k IN SELECT jsonb_object_keys(p_snapshot) LOOP
        IF k NOT IN ('thresholds', 'phenotype', 'tests', 'forms') THEN RAISE EXCEPTION 'Unknown section %', k; END IF;
        IF k = 'tests' AND (jsonb_typeof(p_snapshot->k) <> 'array' OR jsonb_array_length(p_snapshot->k) > 20) THEN
            RAISE EXCEPTION 'Invalid tests section';
        ELSIF k <> 'tests' AND jsonb_typeof(p_snapshot->k) <> 'object' THEN
            RAISE EXCEPTION 'Invalid % section', k;
        END IF;
    END LOOP;
    IF p_snapshot ? 'forms' AND auth.uid() <> p_athlete THEN
        RAISE EXCEPTION 'Only the athlete can share body composition';
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

CREATE OR REPLACE FUNCTION public.lab_reports_list(p_athlete UUID)
RETURNS SETOF public.lab_reports
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM public.lab_gate(p_athlete);
    RETURN QUERY SELECT * FROM public.lab_reports WHERE athlete_id = p_athlete ORDER BY created_at DESC LIMIT 50;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_report_revoke(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_athlete UUID;
BEGIN
    SELECT athlete_id INTO v_athlete FROM public.lab_reports WHERE id = p_id;
    IF v_athlete IS NULL THEN RAISE EXCEPTION 'Report not found'; END IF;
    PERFORM public.lab_gate(v_athlete);
    UPDATE public.lab_reports SET revoked_at = COALESCE(revoked_at, now()) WHERE id = p_id;
END;
$$;

-- Public (anon) read by token: the frozen snapshot plus the creating coach's branding (logo, name, licence badge).
CREATE OR REPLACE FUNCTION public.lab_report_public(p_token TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object(
        'title', r.title,
        'note', r.note,
        'created_at', r.created_at,
        'snapshot', r.snapshot,
        'athlete_name', public.profile_display_name(a.nickname, a.first_name, a.last_name),
        'coach', CASE WHEN r.created_by <> r.athlete_id THEN jsonb_build_object(
            'name', public.profile_display_name(c.nickname, c.first_name, c.last_name),
            'logo_url', cc.logo_url,
            'slug', CASE WHEN cc.is_public THEN cc.slug END,
            'licence', public.coach_licence_public(r.created_by)
        ) END
    )
    FROM public.lab_reports r
    JOIN public.profiles a ON a.id = r.athlete_id
    JOIN public.profiles c ON c.id = r.created_by
    LEFT JOIN public.coach_cards cc ON cc.coach_id = r.created_by
    WHERE r.token = p_token AND r.revoked_at IS NULL AND p_token ~ '^[0-9a-f]{64}$'
$$;

REVOKE ALL ON FUNCTION public.lab_report_create(UUID, TEXT, TEXT, JSONB), public.lab_reports_list(UUID), public.lab_report_revoke(UUID), public.lab_report_public(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lab_report_create(UUID, TEXT, TEXT, JSONB), public.lab_reports_list(UUID), public.lab_report_revoke(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lab_report_public(TEXT) TO anon, authenticated;
