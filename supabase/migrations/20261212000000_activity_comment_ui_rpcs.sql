-- VelocityStack: read helpers for the activity comments UI (issue #224)
--
-- * activity_comment_info(ids): per visible activity the comment count, whether comments are
--   enabled, the owner and active coach (for the "Coach" badge), and whether the viewer is
--   that owner's coach (keeps notification links inside the coach context). Activities the
--   viewer cannot see are simply missing from the result.
-- * activity_mention_candidates(activity, query): riders matching the typed @handle prefix
--   who can see the activity themselves (blocks excluded), so the autocomplete never
--   suggests someone who would not be notified.

CREATE OR REPLACE FUNCTION public.activity_comment_info(p_ids UUID[])
RETURNS TABLE (
    activity_id UUID,
    owner_id UUID,
    comments_enabled BOOLEAN,
    comment_count INTEGER,
    coach_id UUID,
    viewer_is_coach BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT a.id,
           a.user_id,
           a.comments_enabled,
           (SELECT count(*)::int FROM public.activity_comments c WHERE c.activity_id = a.id),
           (SELECT r.coach_id FROM public.coaching_relationships r
             WHERE r.rider_id = a.user_id AND r.status = 'active' LIMIT 1),
           public.is_coach_of(a.user_id)
    FROM public.activities a
    WHERE a.id = ANY (p_ids[1:100])
      AND public.user_can_view_activity(auth.uid(), a.id)
$$;

CREATE OR REPLACE FUNCTION public.activity_mention_candidates(p_activity UUID, p_query TEXT)
RETURNS TABLE (id UUID, nickname TEXT, display_name TEXT, avatar_url TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_like TEXT := replace(replace(replace(lower(btrim(COALESCE(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%';
BEGIN
    IF auth.uid() IS NULL OR NOT public.user_can_view_activity(auth.uid(), p_activity) THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT p.id, p.nickname,
           public.profile_display_name(p.nickname, p.first_name, p.last_name),
           p.avatar_url
    FROM public.profiles p
    WHERE lower(p.nickname) LIKE v_like ESCAPE '\'
      -- only handles the server-side parser can match
      AND p.nickname ~ '^[A-Za-z0-9_.-]{0,39}[A-Za-z0-9_]$'
      AND p.id <> auth.uid()
      AND NOT public.is_blocked_between(p.id, auth.uid())
      AND public.user_can_view_activity(p.id, p_activity)
    ORDER BY lower(p.nickname)
    LIMIT 8;
END;
$$;

REVOKE ALL ON FUNCTION public.activity_comment_info(UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.activity_mention_candidates(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activity_comment_info(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activity_mention_candidates(UUID, TEXT) TO authenticated;
