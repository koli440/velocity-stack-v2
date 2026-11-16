-- Directory: minimal public licence info (body + level, only verified and not expired) and an optional verified-only filter. Additive/idempotent.

DROP FUNCTION IF EXISTS public.list_coaches(TEXT, TEXT, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.list_coaches(p_search TEXT DEFAULT NULL, p_discipline TEXT DEFAULT NULL,
                                                p_limit INTEGER DEFAULT 24, p_offset INTEGER DEFAULT 0,
                                                p_verified_only BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_q TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
    v_like TEXT;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
    IF v_q IS NOT NULL THEN
        v_q := left(v_q, 60);
        v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(row_to_json(t)::JSONB ORDER BY t.name, t.slug)
        FROM (
            SELECT c.slug, public.profile_display_name(p.nickname, p.first_name, p.last_name) AS name,
                   CASE WHEN BTRIM(p.avatar_url) ~ '^https://[^/?#@]+/storage/v1/object/public/avatars/' THEN BTRIM(p.avatar_url) END AS avatar_url,
                   c.logo_url, c.banner_url,
                   c.headline, c.accent, c.disciplines, c.languages, c.location, c.accepting_athletes,
                   (SELECT jsonb_build_object('verified', TRUE, 'body', b.name, 'level', l.level)
                      FROM public.coach_licences l JOIN public.licence_bodies b ON b.id = l.body_id
                     WHERE l.coach_id = c.coach_id AND l.status = 'verified' AND (l.valid_until IS NULL OR l.valid_until >= CURRENT_DATE)) AS licence
            FROM public.coach_cards c JOIN public.profiles p ON p.id = c.coach_id
            WHERE c.is_public AND c.is_listed AND public.coach_module_enabled(c.coach_id)
              AND (auth.uid() IS NULL OR auth.uid() = c.coach_id OR NOT public.is_blocked_between(auth.uid(), c.coach_id))
              AND (NOT COALESCE(p_verified_only, FALSE) OR EXISTS (
                       SELECT 1 FROM public.coach_licences l WHERE l.coach_id = c.coach_id AND l.status = 'verified'
                          AND (l.valid_until IS NULL OR l.valid_until >= CURRENT_DATE)))
              AND (p_discipline IS NULL OR p_discipline = ANY (c.disciplines))
              AND (v_like IS NULL OR public.profile_display_name(p.nickname, p.first_name, p.last_name) ILIKE v_like
                   OR c.headline ILIKE v_like OR c.location ILIKE v_like
                   OR EXISTS (SELECT 1 FROM unnest(c.disciplines || c.languages) x WHERE x ILIKE v_like))
            ORDER BY public.profile_display_name(p.nickname, p.first_name, p.last_name), c.slug
            LIMIT v_limit OFFSET v_offset
        ) t
    ), '[]'::JSONB);
END;
$$;
REVOKE ALL ON FUNCTION public.list_coaches(TEXT, TEXT, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_coaches(TEXT, TEXT, INTEGER, INTEGER, BOOLEAN) TO anon, authenticated;
