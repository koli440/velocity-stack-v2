-- Lab is not part of the coach business layer: it no longer depends on the coach_module flag.
-- Access is the athlete themselves or their active coach (is_coach_of); every Lab RPC calls lab_gate().
CREATE OR REPLACE FUNCTION public.lab_gate(p_athlete UUID)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT public.lab_can_access(p_athlete) THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.lab_gate(UUID) FROM PUBLIC, anon, authenticated;
