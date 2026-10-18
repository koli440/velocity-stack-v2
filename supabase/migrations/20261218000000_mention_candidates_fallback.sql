-- VelocityStack: @mention suggestions never empty for a bare @ (follow-up to 20261217000000)
--
-- Suggestions: ranking only. Everybody who can see the activity (not blocked, not self) is a
-- candidate, also for a bare @, so the list is never empty just because the viewer follows
-- nobody. Relevant people come first: owner, coaches, riders the viewer follows, the viewer's
-- followers, the owner's followers, athletes and earlier commenters.
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
    ORDER BY
        (CASE
            WHEN p.id = v_owner THEN 0
            WHEN EXISTS (SELECT 1 FROM public.coaching_relationships c
                          WHERE c.status = 'active'
                            AND ((c.rider_id = auth.uid() AND c.coach_id = p.id)
                              OR (c.coach_id = auth.uid() AND c.rider_id = p.id)
                              OR (c.rider_id = v_owner AND c.coach_id = p.id))) THEN 1
            WHEN EXISTS (SELECT 1 FROM public.follows f
                          WHERE (f.follower_id = auth.uid() AND f.followee_id = p.id)
                             OR (f.followee_id = auth.uid() AND f.follower_id = p.id)) THEN 2
            WHEN EXISTS (SELECT 1 FROM public.activity_comments m
                          WHERE m.activity_id = p_activity AND m.user_id = p.id) THEN 3
            WHEN EXISTS (SELECT 1 FROM public.follows f
                          WHERE f.followee_id = v_owner AND f.follower_id = p.id) THEN 4
            ELSE 5
         END),
        lower(p.nickname)
    LIMIT 8;
END;
$$;

REVOKE ALL ON FUNCTION public.activity_mention_candidates(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activity_mention_candidates(UUID, TEXT) TO authenticated;
