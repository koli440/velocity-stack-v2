-- Pending coaching relationships are listed in the chat summary (read-only, with a status) so a user who
-- has been invited / has asked for a coach sees the other party instead of nothing. Threads stay unopenable until active.
CREATE OR REPLACE FUNCTION public.chat_threads_summary()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(x ORDER BY (x ->> 'sort')::TIMESTAMPTZ DESC) FROM (
            SELECT jsonb_build_object(
                'id', r.id, 'role', CASE WHEN r.coach_id = v_me THEN 'coach' ELSE 'rider' END,
                'other_id', o.id,
                'other_name', public.profile_display_name(o.nickname, o.first_name, o.last_name),
                'other_avatar', o.avatar_url,
                'status', r.status, 'can_send', r.status = 'active', 'initiated_by_me', r.initiated_by = v_me,
                'last_message_at', t.last_message_at,
                'unread', COALESCE((SELECT count(*) FROM public.chat_messages m
                                    WHERE m.thread_id = r.id AND m.sender_id <> v_me AND m.deleted_at IS NULL
                                      AND m.created_at > COALESCE((SELECT cr.last_read_at FROM public.chat_reads cr WHERE cr.thread_id = r.id AND cr.user_id = v_me), '-infinity')), 0),
                'sort', COALESCE(t.last_message_at, r.responded_at, r.created_at)) AS x
            FROM public.coaching_relationships r
            LEFT JOIN public.chat_threads t ON t.id = r.id
            JOIN public.profiles o ON o.id = CASE WHEN r.coach_id = v_me THEN r.rider_id ELSE r.coach_id END
            WHERE v_me IN (r.coach_id, r.rider_id)
              AND NOT public.is_blocked_between(r.coach_id, r.rider_id)
              AND (r.status IN ('active', 'pending') OR (r.status = 'ended' AND r.rider_id = v_me AND t.id IS NOT NULL))
        ) s), '[]'::JSONB);
END $$;

NOTIFY pgrst, 'reload schema';
