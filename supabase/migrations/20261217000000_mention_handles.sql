-- VelocityStack: mentionable handles for every rider (fix: @mention suggestions stayed empty)
--
-- Root cause: activity_mention_candidates (and the mention parser) only accepted nicknames
-- matching ^[A-Za-z0-9_.-]*[A-Za-z0-9_]$. Real nicknames are free text (spaces, accents, emoji,
-- e-mail local parts), so most riders were filtered out and the list was empty.
-- A rider's mention handle is now the nickname without everything that cannot be typed in an
-- @handle (letters, digits, "_", "." and "-" stay; trailing "." / "-" dropped; max 40 chars).
-- "Koen Olijslagers" -> @KoenOlijslagers. Riders whose nickname yields no handle are skipped.

CREATE OR REPLACE FUNCTION public.mention_handle(p_nickname TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT NULLIF(
        left(regexp_replace(regexp_replace(COALESCE(p_nickname, ''), '[^[:alnum:]_.-]+', '', 'g'),
                            '[.-]+$', ''), 40),
        '')
$$;
GRANT EXECUTE ON FUNCTION public.mention_handle(TEXT) TO authenticated;

-- Parser: handles are matched against mention_handle(nickname).
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
        SELECT DISTINCT lower(regexp_replace(g[1], '[.-]+$', '')) AS handle
        FROM regexp_matches(c.body, '(?:^|[^[:alnum:]_])@([[:alnum:]_.-]{1,40})', 'g') AS m(g)
        LIMIT 10
    ) h
    JOIN public.profiles p ON lower(public.mention_handle(p.nickname)) = h.handle
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

-- Suggestions: now also returns `handle` (what is inserted after the @).
DROP FUNCTION IF EXISTS public.activity_mention_candidates(UUID, TEXT);
CREATE FUNCTION public.activity_mention_candidates(p_activity UUID, p_query TEXT)
RETURNS TABLE (id UUID, nickname TEXT, display_name TEXT, avatar_url TEXT, handle TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_q TEXT := lower(btrim(COALESCE(p_query, '')));
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
           public.mention_handle(p.nickname)
    FROM public.profiles p
    WHERE public.mention_handle(p.nickname) IS NOT NULL
      AND (lower(public.mention_handle(p.nickname)) LIKE v_like ESCAPE '\'
           OR lower(COALESCE(p.nickname, '')) LIKE v_like ESCAPE '\')
      AND p.id <> auth.uid()
      AND NOT public.is_blocked_between(p.id, auth.uid())
      AND public.user_can_view_activity(p.id, p_activity)
      AND (
          v_q <> ''
          OR p.id = v_owner
          OR EXISTS (SELECT 1 FROM public.follows f
                      WHERE f.follower_id = auth.uid() AND f.followee_id = p.id)
          OR EXISTS (SELECT 1 FROM public.coaching_relationships c
                      WHERE c.status = 'active'
                        AND ((c.rider_id = auth.uid() AND c.coach_id = p.id)
                          OR (c.coach_id = auth.uid() AND c.rider_id = p.id)
                          OR (c.rider_id = v_owner AND c.coach_id = p.id)))
          OR EXISTS (SELECT 1 FROM public.activity_comments m
                      WHERE m.activity_id = p_activity AND m.user_id = p.id)
      )
    ORDER BY
        (p.id = v_owner
         OR EXISTS (SELECT 1 FROM public.follows f
                     WHERE f.follower_id = auth.uid() AND f.followee_id = p.id)
         OR EXISTS (SELECT 1 FROM public.coaching_relationships c
                     WHERE c.status = 'active'
                       AND ((c.rider_id = auth.uid() AND c.coach_id = p.id)
                         OR (c.coach_id = auth.uid() AND c.rider_id = p.id)
                         OR (c.rider_id = v_owner AND c.coach_id = p.id)))) DESC,
        lower(p.nickname)
    LIMIT 8;
END;
$$;

REVOKE ALL ON FUNCTION public.activity_mention_candidates(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activity_mention_candidates(UUID, TEXT) TO authenticated;
