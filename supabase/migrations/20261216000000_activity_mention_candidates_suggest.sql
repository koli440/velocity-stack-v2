-- VelocityStack: @mention suggestions on a bare "@" (fix for #222 follow-up)
--
-- Root cause: the UI never called activity_mention_candidates for an empty query (typing just
-- "@" showed nothing) and the RPC only ranked by nickname, so relevant people (owner, coach,
-- followed riders, athletes) were not offered first.
-- Now an empty query returns the relevant people straight away, a typed prefix filters them,
-- and other riders who can see the activity are only offered once something is typed.
-- Relevant = activity owner, owner's/viewer's active coach, riders the viewer follows,
-- the viewer's athletes (when coach) and earlier commenters. Always: can see the activity,
-- not blocked, not self, mentionable nickname.

CREATE OR REPLACE FUNCTION public.activity_mention_candidates(p_activity UUID, p_query TEXT)
RETURNS TABLE (id UUID, nickname TEXT, display_name TEXT, avatar_url TEXT)
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
           p.avatar_url
    FROM public.profiles p
    WHERE lower(p.nickname) LIKE v_like ESCAPE '\'
      AND p.nickname ~ '^[A-Za-z0-9_.-]{0,39}[A-Za-z0-9_]$'
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
