-- chat_messages_list: participants never get NULL; they get a read-only state with the reason instead.
CREATE OR REPLACE FUNCTION public.chat_messages_list(p_thread UUID, p_before TIMESTAMPTZ DEFAULT NULL, p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_access TEXT := public.chat_thread_access(p_thread);
    v_rider UUID;
    r public.coaching_relationships;
BEGIN
    IF v_access IS NULL THEN
        -- Participants always get a read-only state with the reason (pending / ended / declined / blocked);
        -- NULL is only for strangers and unknown ids, so the page never shows a generic "not found" for a listed row.
        SELECT * INTO r FROM public.coaching_relationships WHERE id = p_thread;
        IF NOT FOUND OR auth.uid() IS NULL OR auth.uid() NOT IN (r.coach_id, r.rider_id) THEN RETURN NULL; END IF;
        RETURN jsonb_build_object('can_send', false, 'rider_id', r.rider_id, 'initiated_by_me', r.initiated_by = auth.uid(),
            'status', CASE WHEN public.is_blocked_between(r.coach_id, r.rider_id) THEN 'blocked'
                           WHEN r.status = 'ended' AND auth.uid() = r.coach_id THEN 'ended_coach'
                           WHEN r.status = 'ended' THEN 'ended_no_history' ELSE r.status END,
            'other_name', (SELECT public.profile_display_name(o.nickname, o.first_name, o.last_name) FROM public.profiles o
                           WHERE o.id = CASE WHEN r.coach_id = auth.uid() THEN r.rider_id ELSE r.coach_id END),
            'other_id', CASE WHEN r.coach_id = auth.uid() THEN r.rider_id ELSE r.coach_id END, 'messages', '[]'::JSONB);
    END IF;
    SELECT rider_id INTO v_rider FROM public.coaching_relationships WHERE id = p_thread;
    RETURN jsonb_build_object('can_send', v_access = 'rw', 'status', CASE WHEN v_access = 'rw' THEN 'active' ELSE 'ended' END, 'rider_id', v_rider, 'messages', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', m.id, 'sender_id', m.sender_id, 'created_at', m.created_at, 'edited_at', m.edited_at,
            'deleted', m.deleted_at IS NOT NULL,
            'body', CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END,
            'activity', CASE WHEN m.deleted_at IS NULL THEN (SELECT jsonb_build_object('id', a.id, 'title', a.title, 'date', a.activity_date)
                                                              FROM public.activities a WHERE a.id = m.activity_id AND a.user_id = v_rider) END,
            'workout', CASE WHEN m.deleted_at IS NULL THEN (SELECT jsonb_build_object('id', w.id, 'title', w.title, 'date', w.workout_date)
                                                             FROM public.planned_workouts w WHERE w.id = m.planned_workout_id AND w.rider_id = v_rider) END)
            ORDER BY m.created_at DESC)
        FROM (SELECT * FROM public.chat_messages
              WHERE thread_id = p_thread AND (p_before IS NULL OR created_at < p_before)
              ORDER BY created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)) m), '[]'::JSONB));
END $$;

NOTIFY pgrst, 'reload schema';
