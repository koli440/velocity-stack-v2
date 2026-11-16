-- Chat: a thread that does not exist yet (no message sent) must be openable by both sides of an active
-- coaching relationship, so the first message can be sent from /chat/<relationship id>. Access is derived from the
-- relationship; a missing thread row only matters for ended relationships (the rider needs existing history).
CREATE OR REPLACE FUNCTION public.chat_thread_access(p_thread UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    r public.coaching_relationships;
BEGIN
    IF v_me IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO r FROM public.coaching_relationships WHERE id = p_thread;
    IF NOT FOUND OR v_me NOT IN (r.coach_id, r.rider_id) THEN RETURN NULL; END IF;
    IF NOT public.coach_module_enabled(r.coach_id) OR public.is_blocked_between(r.coach_id, r.rider_id) THEN RETURN NULL; END IF;
    IF r.status = 'active' THEN RETURN 'rw'; END IF;
    IF r.status = 'ended' AND v_me = r.rider_id AND EXISTS (SELECT 1 FROM public.chat_threads WHERE id = p_thread) THEN RETURN 'r'; END IF;
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.chat_messages_list(p_thread UUID, p_before TIMESTAMPTZ DEFAULT NULL, p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_access TEXT := public.chat_thread_access(p_thread);
    v_rider UUID;
BEGIN
    IF v_access IS NULL THEN RETURN NULL; END IF;
    SELECT rider_id INTO v_rider FROM public.coaching_relationships WHERE id = p_thread;
    RETURN jsonb_build_object('can_send', v_access = 'rw', 'rider_id', v_rider, 'messages', COALESCE((
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

CREATE OR REPLACE FUNCTION public.mark_chat_read(p_thread UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    t public.chat_threads;
BEGIN
    IF public.chat_thread_access(p_thread) IS NULL THEN RETURN; END IF;
    SELECT * INTO t FROM public.chat_threads WHERE id = p_thread;
    IF NOT FOUND THEN RETURN; END IF;
    INSERT INTO public.chat_reads (thread_id, user_id) VALUES (p_thread, auth.uid())
        ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = NOW();
    UPDATE public.notifications SET read_at = NOW()
        WHERE user_id = auth.uid() AND type = 'coach_message' AND read_at IS NULL
          AND actor_id = CASE WHEN auth.uid() = t.coach_id THEN t.rider_id ELSE t.coach_id END;
END $$;

NOTIFY pgrst, 'reload schema';
