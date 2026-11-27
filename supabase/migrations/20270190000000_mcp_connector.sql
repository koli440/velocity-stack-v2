-- MCP connector (docs/mcp.md): Claude (or any MCP client) acts for a rider through an access token of our own
-- OAuth provider (20270129000000_partner_oauth.sql). The /api/mcp route runs with the service role, so these
-- wrappers are the only database entry points it uses for planning:
--
--  * Every wrapper takes the SHA-256 hash of the bearer token and resolves the acting user itself
--    (mcp_token_user): grant not revoked / rotated / expired, app approved, scope granted. The route never
--    passes a user id of its own.
--  * The wrappers then act AS that user for the rest of the call (request.jwt claims set transaction-locally,
--    same pattern as bots_coach_edit) and call the existing RPCs, so auth.uid(), is_coach_of(), the
--    validation, the per-day limit and the created_by / set_by_coach stamps are exactly those of the app.
--  * EXECUTE only for service_role. New scopes need no schema change (developer_apps.scopes is free text,
--    validated in the app). Additive and idempotent.

-- 1. Token -> acting user ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mcp_token_user(p_token_hash TEXT, p_scope TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user UUID;
    v_scopes TEXT[];
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'invalid_token';
    END IF;
    SELECT g.user_id, g.scopes INTO v_user, v_scopes
      FROM public.oauth_grants g
      JOIN public.developer_apps a ON a.id = g.app_id
     WHERE g.access_token_hash = p_token_hash
       AND g.revoked_at IS NULL AND g.rotated_at IS NULL
       AND g.access_expires_at > NOW()
       AND a.status = 'approved';
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'invalid_token';
    END IF;
    IF p_scope IS NOT NULL AND NOT (p_scope = ANY (v_scopes)) THEN
        RAISE EXCEPTION 'insufficient_scope';
    END IF;
    RETURN v_user;
END;
$$;

-- Acts as p_user for the rest of the transaction (auth.uid() = p_user, role authenticated).
CREATE OR REPLACE FUNCTION public.mcp_act_as(p_user UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF p_user IS NULL THEN
        RAISE EXCEPTION 'invalid_token';
    END IF;
    PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::TEXT, true);
END;
$$;

-- Token user, or (coach) the given athlete when the token user actively coaches them.
CREATE OR REPLACE FUNCTION public.mcp_resolve_rider(p_token_hash TEXT, p_scope TEXT, p_rider UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user UUID := public.mcp_token_user(p_token_hash, p_scope);
BEGIN
    PERFORM public.mcp_act_as(v_user);
    IF p_rider IS NULL OR p_rider = v_user THEN
        RETURN v_user;
    END IF;
    IF NOT public.is_coach_of(p_rider) THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;
    RETURN p_rider;
END;
$$;

-- What the token user can use (for tools/list and get_athlete): coached athletes and the macro planner.
CREATE OR REPLACE FUNCTION public.mcp_capabilities(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user UUID := public.mcp_token_user(p_token_hash, NULL);
BEGIN
    PERFORM public.mcp_act_as(v_user);
    RETURN jsonb_build_object(
        'user_id', v_user,
        'macro_planner', public.macro_planner_enabled(v_user),
        -- an athlete sees the plan their coach published (no athlete-side flag)
        'has_macro_plan', public.my_macro_plan() IS NOT NULL,
        'athletes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', c.rider_id,
                       'name', public.profile_display_name(p.nickname, p.first_name, p.last_name))
                   ORDER BY c.rider_id)
              FROM public.coaching_relationships c
              JOIN public.profiles p ON p.id = c.rider_id
             WHERE c.coach_id = v_user AND c.status = 'active'
               AND NOT public.is_blocked_between(c.coach_id, c.rider_id)), '[]'::JSONB));
END;
$$;

-- 2. Planned workouts --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mcp_planned_list(p_token_hash TEXT, p_rider UUID, p_from DATE, p_to DATE)
RETURNS SETOF public.planned_workouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_rider UUID := public.mcp_resolve_rider(p_token_hash, 'plans:read', p_rider);
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
        RAISE EXCEPTION 'Pick a range of at most 366 days';
    END IF;
    RETURN QUERY
        SELECT w.* FROM public.planned_workouts w
         WHERE w.rider_id = v_rider AND w.workout_date BETWEEN p_from AND p_to
         ORDER BY w.workout_date, w.created_at, w.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_planned_create(
    p_token_hash TEXT, p_rider UUID, p_date DATE, p_discipline TEXT, p_title TEXT, p_description TEXT,
    p_dsl TEXT DEFAULT NULL, p_manifest JSONB DEFAULT NULL, p_template_name TEXT DEFAULT NULL)
RETURNS public.planned_workouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user UUID := public.mcp_token_user(p_token_hash, 'plans:write');
BEGIN
    PERFORM public.mcp_act_as(v_user);
    -- planned_workout_create re-checks own calendar or active coach (planned_workouts_can_plan).
    RETURN public.planned_workout_create(COALESCE(p_rider, v_user), p_date, p_discipline, p_title,
                                         COALESCE(p_description, ''), p_dsl, p_manifest, p_template_name);
END;
$$;

-- Plain fields only (same columns the app lets clients update): workout_date, discipline, title, description, status.
CREATE OR REPLACE FUNCTION public.mcp_planned_update(p_token_hash TEXT, p_id UUID, p_fields JSONB)
RETURNS public.planned_workouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user UUID := public.mcp_token_user(p_token_hash, 'plans:write');
    w public.planned_workouts%ROWTYPE;
    f JSONB := COALESCE(p_fields, '{}'::JSONB);
BEGIN
    PERFORM public.mcp_act_as(v_user);
    IF jsonb_typeof(f) <> 'object' OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('workout_date', 'discipline', 'title', 'description', 'status')) THEN
        RAISE EXCEPTION 'Invalid fields';
    END IF;
    SELECT * INTO w FROM public.planned_workouts WHERE id = p_id;
    IF NOT FOUND OR NOT public.planned_workouts_can_plan(w.rider_id) THEN
        RAISE EXCEPTION 'Planned workout not found';
    END IF;
    IF f ? 'status' AND f->>'status' = 'skipped' AND w.activity_id IS NOT NULL THEN
        RAISE EXCEPTION 'A completed workout cannot be skipped';
    END IF;
    BEGIN
        UPDATE public.planned_workouts SET
            workout_date = CASE WHEN f ? 'workout_date' THEN (f->>'workout_date')::DATE ELSE workout_date END,
            discipline   = CASE WHEN f ? 'discipline' THEN f->>'discipline' ELSE discipline END,
            title        = CASE WHEN f ? 'title' THEN f->>'title' ELSE title END,
            description  = CASE WHEN f ? 'description' THEN COALESCE(f->>'description', '') ELSE description END,
            status       = CASE WHEN f ? 'status' THEN f->>'status' ELSE status END
         WHERE id = p_id RETURNING * INTO w;
    EXCEPTION
        WHEN check_violation OR not_null_violation OR invalid_datetime_format OR datetime_field_overflow THEN
            RAISE EXCEPTION 'Invalid workout values';
    END;
    RETURN w;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_planned_set_structure(
    p_token_hash TEXT, p_id UUID, p_dsl TEXT, p_manifest JSONB, p_template_name TEXT DEFAULT NULL)
RETURNS public.planned_workouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user UUID := public.mcp_token_user(p_token_hash, 'plans:write');
BEGIN
    PERFORM public.mcp_act_as(v_user);
    RETURN public.planned_workout_set_structure(p_id, p_dsl, p_manifest, p_template_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_planned_delete(p_token_hash TEXT, p_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user UUID := public.mcp_token_user(p_token_hash, 'plans:write');
    w public.planned_workouts%ROWTYPE;
BEGIN
    PERFORM public.mcp_act_as(v_user);
    SELECT * INTO w FROM public.planned_workouts WHERE id = p_id;
    IF NOT FOUND OR NOT public.planned_workouts_can_plan(w.rider_id) THEN
        RAISE EXCEPTION 'Planned workout not found';
    END IF;
    DELETE FROM public.planned_workouts WHERE id = p_id;
    RETURN p_id;
END;
$$;

-- 3. Macro plan (read only; flag and relationship checked by the existing RPCs) ------------
-- Own account: the plan the active coach published (my_macro_plan). Coach with p_rider: the coach's plan.
CREATE OR REPLACE FUNCTION public.mcp_macro_plan_get(p_token_hash TEXT, p_rider UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user UUID := public.mcp_token_user(p_token_hash, 'plans:read');
BEGIN
    PERFORM public.mcp_act_as(v_user);
    IF p_rider IS NULL OR p_rider = v_user THEN
        RETURN public.my_macro_plan();
    END IF;
    RETURN public.macro_plan_get(p_rider);
END;
$$;

-- 4. Privileges: service role only ----------------------------------------------------------
REVOKE ALL ON FUNCTION public.mcp_token_user(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_act_as(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_resolve_rider(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_capabilities(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_planned_list(TEXT, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_planned_create(TEXT, UUID, DATE, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_planned_update(TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_planned_set_structure(TEXT, UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_planned_delete(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_macro_plan_get(TEXT, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mcp_token_user(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_act_as(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_rider(TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_capabilities(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_planned_list(TEXT, UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_planned_create(TEXT, UUID, DATE, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_planned_update(TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_planned_set_structure(TEXT, UUID, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_planned_delete(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_macro_plan_get(TEXT, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
