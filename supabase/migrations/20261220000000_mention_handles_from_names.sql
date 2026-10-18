-- VelocityStack: mentionable handle for EVERY rider, also without a nickname (fix: riders shown
-- as "Jana Kolarova" were never suggested or notified)
--
-- Root cause: mention_handle() looked at the nickname only. Riders whose nickname is NULL/empty
-- (shown via profile_display_name as first + last name) had no handle and were dropped by both
-- the suggestions and the mention parser.
-- profile_mention_handle(id, nickname, first, last): nickname -> first+last collapsed
-- ("JanaKolarova") -> first name -> "rider" + short id. Always non-null.
-- Matching is case- and accent-insensitive via mention_fold() (lower + Latin accent folding).
-- Suggestions match the typed text against handle, nickname, first and last name.

CREATE OR REPLACE FUNCTION public.mention_fold(p_text TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT translate(lower(COALESCE(p_text, '')), 'áàâäãåāăąćčçďđéèêëēěęğíìîïīıňńñóòôöõőøřŕśšşťţúùûüūůűýÿźžżł', 'aaaaaaaaacccddeeeeeeegiiiiiinnnooooooorrsssttuuuuuuuyyzzzl')
$$;
GRANT EXECUTE ON FUNCTION public.mention_fold(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.profile_mention_handle(p_id UUID, p_nick TEXT, p_first TEXT, p_last TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT COALESCE(
        public.mention_handle(p_nick),
        public.mention_handle(COALESCE(p_first, '') || COALESCE(p_last, '')),
        public.mention_handle(p_first),
        'rider' || left(replace(p_id::text, '-', ''), 6))
$$;
GRANT EXECUTE ON FUNCTION public.profile_mention_handle(UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_comment_mentions(p_comment UUID)
RETURNS UUID[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c public.activity_comments;
    v_new UUID[];
BEGIN
    SELECT * INTO c FROM public.activity_comments WHERE id = p_comment;
    IF NOT FOUND THEN
        RETURN ARRAY[]::UUID[];
    END IF;

    SELECT COALESCE(array_agg(DISTINCT p.id), ARRAY[]::UUID[]) INTO v_new
    FROM (
        SELECT DISTINCT public.mention_fold(regexp_replace(g[1], '[.-]+$', '')) AS handle
        FROM regexp_matches(c.body, '(?:^|[^[:alnum:]_])@([[:alnum:]_.-]{1,40})', 'g') AS m(g)
        LIMIT 10
    ) h
    JOIN public.profiles p
      ON public.mention_fold(public.profile_mention_handle(p.id, p.nickname, p.first_name, p.last_name)) = h.handle
    WHERE p.id <> c.user_id
      AND public.user_can_view_activity(p.id, c.activity_id)
      AND NOT public.is_blocked_between(p.id, c.user_id);

    DELETE FROM public.activity_comment_mentions
        WHERE comment_id = p_comment AND NOT (user_id = ANY (v_new));

    SELECT COALESCE(array_agg(u), ARRAY[]::UUID[]) INTO v_new
    FROM unnest(v_new) u
    WHERE NOT EXISTS (
        SELECT 1 FROM public.activity_comment_mentions
        WHERE comment_id = p_comment AND user_id = u);

    INSERT INTO public.activity_comment_mentions (comment_id, user_id)
        SELECT p_comment, u FROM unnest(v_new) u
        ON CONFLICT DO NOTHING;
    RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_comment_mentions(UUID) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.activity_mention_candidates(UUID, TEXT);
CREATE FUNCTION public.activity_mention_candidates(p_activity UUID, p_query TEXT)
RETURNS TABLE (id UUID, nickname TEXT, display_name TEXT, avatar_url TEXT, handle TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_q TEXT := public.mention_fold(btrim(COALESCE(p_query, '')));
    v_like TEXT := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_owner UUID;
BEGIN
    IF auth.uid() IS NULL OR NOT public.user_can_view_activity(auth.uid(), p_activity) THEN
        RETURN;
    END IF;
    SELECT a.user_id INTO v_owner FROM public.activities a WHERE a.id = p_activity;

    RETURN QUERY
    SELECT p.id, p.nickname,
           public.profile_display_name(p.nickname, p.first_name, p.last_name),
           p.avatar_url,
           public.profile_mention_handle(p.id, p.nickname, p.first_name, p.last_name)
    FROM public.profiles p
    WHERE (public.mention_fold(public.profile_mention_handle(p.id, p.nickname, p.first_name, p.last_name)) LIKE v_like ESCAPE '\'
           OR public.mention_fold(p.nickname) LIKE v_like ESCAPE '\'
           OR public.mention_fold(p.first_name) LIKE v_like ESCAPE '\'
           OR public.mention_fold(p.last_name) LIKE v_like ESCAPE '\')
      AND p.id <> auth.uid()
      AND NOT public.is_blocked_between(p.id, auth.uid())
      AND public.user_can_view_activity(p.id, p_activity)
      AND (v_q <> '' OR NOT p.is_bot OR p.id = v_owner
           OR EXISTS (SELECT 1 FROM public.follows f
                       WHERE f.follower_id = auth.uid() AND f.followee_id = p.id)
           OR EXISTS (SELECT 1 FROM public.activity_comments m
                       WHERE m.activity_id = p_activity AND m.user_id = p.id))
    ORDER BY
        (CASE
            WHEN p.id = v_owner THEN 0
            WHEN EXISTS (SELECT 1 FROM public.coaching_relationships c
                          WHERE c.status = 'active'
                            AND ((c.rider_id = auth.uid() AND c.coach_id = p.id)
                              OR (c.coach_id = auth.uid() AND c.rider_id = p.id)
                              OR (c.rider_id = v_owner AND c.coach_id = p.id))) THEN 1
            WHEN EXISTS (SELECT 1 FROM public.follows f
                          WHERE f.follower_id = auth.uid() AND f.followee_id = p.id) THEN 2
            WHEN NOT p.is_bot AND EXISTS (SELECT 1 FROM public.follows f
                          WHERE f.followee_id = auth.uid() AND f.follower_id = p.id) THEN 3
            WHEN EXISTS (SELECT 1 FROM public.activity_comments m
                          WHERE m.activity_id = p_activity AND m.user_id = p.id) THEN 3
            WHEN EXISTS (SELECT 1 FROM public.follows f
                          WHERE f.followee_id = v_owner AND f.follower_id = p.id) THEN 4
            WHEN NOT p.is_bot THEN 5
            ELSE 6
         END),
        lower(public.profile_mention_handle(p.id, p.nickname, p.first_name, p.last_name))
    LIMIT 10;
END;
$$;

REVOKE ALL ON FUNCTION public.activity_mention_candidates(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activity_mention_candidates(UUID, TEXT) TO authenticated;
