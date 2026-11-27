-- MCP connector: calendar races (goals) and calendar notes (docs/mcp.md). Same model as the planned-workout
-- wrappers of 20270190000000_mcp_connector.sql:
--
--  * Every wrapper takes the SHA-256 hash of the bearer token and resolves the acting user itself
--    (mcp_token_user / mcp_resolve_rider); the route never passes a user id of its own.
--  * The wrappers act AS that user (mcp_act_as), so the existing stamp triggers (created_by / updated_by /
--    set_by_coach, per-day limits, trimming) behave exactly as for the signed-in rider, and check the same rule
--    as the tables' RLS policies: own calendar, or an athlete the user actively coaches (is_coach_of).
--  * Scopes: races and notes are part of the calendar, so they use plans:read / plans:write (no new scope, an
--    existing connection keeps working).
--  * Only the client-writable columns of the app can be written (races: race_date, name, discipline, priority,
--    location, notes; notes: note_date, title, body).
--  * EXECUTE only for service_role. Additive and idempotent.

-- 1. Races -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mcp_races_list(p_token_hash TEXT, p_rider UUID, p_from DATE, p_to DATE)
RETURNS SETOF public.calendar_races
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_rider UUID := public.mcp_resolve_rider(p_token_hash, 'plans:read', p_rider);
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
        RAISE EXCEPTION 'Pick a range of at most 366 days';
    END IF;
    RETURN QUERY
        SELECT r.* FROM public.calendar_races r
         WHERE r.rider_id = v_rider AND r.race_date BETWEEN p_from AND p_to
         ORDER BY r.race_date, r.race_time NULLS LAST, r.created_at, r.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_race_create(p_token_hash TEXT, p_rider UUID, p_date DATE, p_fields JSONB)
RETURNS public.calendar_races
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_rider UUID := public.mcp_resolve_rider(p_token_hash, 'plans:write', p_rider);
    f JSONB := COALESCE(p_fields, '{}'::JSONB);
    r public.calendar_races%ROWTYPE;
BEGIN
    IF jsonb_typeof(f) <> 'object' OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('name', 'discipline', 'priority', 'location', 'notes')) THEN
        RAISE EXCEPTION 'Invalid fields';
    END IF;
    BEGIN
        INSERT INTO public.calendar_races (rider_id, race_date, name, discipline, priority, location, notes)
        VALUES (v_rider, p_date, f->>'name', COALESCE(f->>'discipline', 'ride'), COALESCE(f->>'priority', 'B'),
                COALESCE(f->>'location', ''), COALESCE(f->>'notes', ''))
        RETURNING * INTO r;
    EXCEPTION
        WHEN check_violation OR not_null_violation THEN
            RAISE EXCEPTION 'Invalid race values';
    END;
    RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_race_update(p_token_hash TEXT, p_id UUID, p_fields JSONB)
RETURNS public.calendar_races
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user UUID := public.mcp_token_user(p_token_hash, 'plans:write');
    f JSONB := COALESCE(p_fields, '{}'::JSONB);
    r public.calendar_races%ROWTYPE;
BEGIN
    PERFORM public.mcp_act_as(v_user);
    IF jsonb_typeof(f) <> 'object' OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(f) k
         WHERE k NOT IN ('race_date', 'name', 'discipline', 'priority', 'location', 'notes')) THEN
        RAISE EXCEPTION 'Invalid fields';
    END IF;
    SELECT * INTO r FROM public.calendar_races WHERE id = p_id;
    IF NOT FOUND OR NOT (r.rider_id = v_user OR public.is_coach_of(r.rider_id)) THEN
        RAISE EXCEPTION 'Race not found';
    END IF;
    BEGIN
        UPDATE public.calendar_races SET
            race_date  = CASE WHEN f ? 'race_date' THEN (f->>'race_date')::DATE ELSE race_date END,
            name       = CASE WHEN f ? 'name' THEN f->>'name' ELSE name END,
            discipline = CASE WHEN f ? 'discipline' THEN f->>'discipline' ELSE discipline END,
            priority   = CASE WHEN f ? 'priority' THEN f->>'priority' ELSE priority END,
            location   = CASE WHEN f ? 'location' THEN COALESCE(f->>'location', '') ELSE location END,
            notes      = CASE WHEN f ? 'notes' THEN COALESCE(f->>'notes', '') ELSE notes END
         WHERE id = p_id RETURNING * INTO r;
    EXCEPTION
        WHEN check_violation OR not_null_violation OR invalid_datetime_format OR datetime_field_overflow THEN
            RAISE EXCEPTION 'Invalid race values';
    END;
    RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_race_delete(p_token_hash TEXT, p_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user UUID := public.mcp_token_user(p_token_hash, 'plans:write');
    v_rider UUID;
BEGIN
    PERFORM public.mcp_act_as(v_user);
    SELECT rider_id INTO v_rider FROM public.calendar_races WHERE id = p_id;
    IF v_rider IS NULL OR NOT (v_rider = v_user OR public.is_coach_of(v_rider)) THEN
        RAISE EXCEPTION 'Race not found';
    END IF;
    DELETE FROM public.calendar_races WHERE id = p_id;
    RETURN p_id;
END;
$$;

-- 2. Notes -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mcp_notes_list(p_token_hash TEXT, p_rider UUID, p_from DATE, p_to DATE)
RETURNS SETOF public.calendar_notes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_rider UUID := public.mcp_resolve_rider(p_token_hash, 'plans:read', p_rider);
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
        RAISE EXCEPTION 'Pick a range of at most 366 days';
    END IF;
    RETURN QUERY
        SELECT n.* FROM public.calendar_notes n
         WHERE n.rider_id = v_rider AND n.note_date BETWEEN p_from AND p_to
         ORDER BY n.note_date, n.created_at, n.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_note_create(p_token_hash TEXT, p_rider UUID, p_date DATE, p_fields JSONB)
RETURNS public.calendar_notes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_rider UUID := public.mcp_resolve_rider(p_token_hash, 'plans:write', p_rider);
    f JSONB := COALESCE(p_fields, '{}'::JSONB);
    n public.calendar_notes%ROWTYPE;
BEGIN
    IF jsonb_typeof(f) <> 'object' OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('title', 'body')) THEN
        RAISE EXCEPTION 'Invalid fields';
    END IF;
    BEGIN
        INSERT INTO public.calendar_notes (rider_id, note_date, title, body)
        VALUES (v_rider, p_date, f->>'title', COALESCE(f->>'body', ''))
        RETURNING * INTO n;
    EXCEPTION
        WHEN check_violation OR not_null_violation THEN
            RAISE EXCEPTION 'Invalid note values';
    END;
    RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_note_update(p_token_hash TEXT, p_id UUID, p_fields JSONB)
RETURNS public.calendar_notes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user UUID := public.mcp_token_user(p_token_hash, 'plans:write');
    f JSONB := COALESCE(p_fields, '{}'::JSONB);
    n public.calendar_notes%ROWTYPE;
BEGIN
    PERFORM public.mcp_act_as(v_user);
    IF jsonb_typeof(f) <> 'object' OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('note_date', 'title', 'body')) THEN
        RAISE EXCEPTION 'Invalid fields';
    END IF;
    SELECT * INTO n FROM public.calendar_notes WHERE id = p_id;
    IF NOT FOUND OR NOT (n.rider_id = v_user OR public.is_coach_of(n.rider_id)) THEN
        RAISE EXCEPTION 'Note not found';
    END IF;
    BEGIN
        UPDATE public.calendar_notes SET
            note_date = CASE WHEN f ? 'note_date' THEN (f->>'note_date')::DATE ELSE note_date END,
            title     = CASE WHEN f ? 'title' THEN f->>'title' ELSE title END,
            body      = CASE WHEN f ? 'body' THEN COALESCE(f->>'body', '') ELSE body END
         WHERE id = p_id RETURNING * INTO n;
    EXCEPTION
        WHEN check_violation OR not_null_violation OR invalid_datetime_format OR datetime_field_overflow THEN
            RAISE EXCEPTION 'Invalid note values';
    END;
    RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_note_delete(p_token_hash TEXT, p_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user UUID := public.mcp_token_user(p_token_hash, 'plans:write');
    v_rider UUID;
BEGIN
    PERFORM public.mcp_act_as(v_user);
    SELECT rider_id INTO v_rider FROM public.calendar_notes WHERE id = p_id;
    IF v_rider IS NULL OR NOT (v_rider = v_user OR public.is_coach_of(v_rider)) THEN
        RAISE EXCEPTION 'Note not found';
    END IF;
    DELETE FROM public.calendar_notes WHERE id = p_id;
    RETURN p_id;
END;
$$;

-- 3. Privileges: service role only ----------------------------------------------------------
REVOKE ALL ON FUNCTION public.mcp_races_list(TEXT, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_race_create(TEXT, UUID, DATE, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_race_update(TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_race_delete(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_notes_list(TEXT, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_note_create(TEXT, UUID, DATE, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_note_update(TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_note_delete(TEXT, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mcp_races_list(TEXT, UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_race_create(TEXT, UUID, DATE, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_race_update(TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_race_delete(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_notes_list(TEXT, UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_note_create(TEXT, UUID, DATE, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_note_update(TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_note_delete(TEXT, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
