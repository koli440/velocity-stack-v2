-- Messaging is not tied to the `coach_module` flag/allow-list: the flag only gates the coaching business layer
-- (coach card, onboarding, licences, billing, directory) and the Lab. Any active coach <-> athlete pair can chat;
-- blocks and the relationship status rules still apply.
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
    IF public.is_blocked_between(r.coach_id, r.rider_id) THEN RETURN NULL; END IF;
    IF r.status = 'active' THEN RETURN 'rw'; END IF;
    IF r.status = 'ended' AND v_me = r.rider_id AND EXISTS (SELECT 1 FROM public.chat_threads WHERE id = p_thread) THEN RETURN 'r'; END IF;
    RETURN NULL;
END $$;

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
                'status', r.status, 'can_send', r.status = 'active',
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
              AND (r.status = 'active' OR (r.status = 'ended' AND r.rider_id = v_me AND t.id IS NOT NULL))
        ) s), '[]'::JSONB);
END $$;

CREATE OR REPLACE FUNCTION public.send_chat_message(p_thread UUID, p_body TEXT, p_activity UUID DEFAULT NULL, p_workout UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    r public.coaching_relationships;
    v_body TEXT := btrim(COALESCE(p_body, ''));
    v_id UUID;
    v_to UUID;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    SELECT * INTO r FROM public.coaching_relationships WHERE id = p_thread;
    IF NOT FOUND OR v_me NOT IN (r.coach_id, r.rider_id) THEN RAISE EXCEPTION 'Chat not found'; END IF;
    IF r.status <> 'active' OR public.is_blocked_between(r.coach_id, r.rider_id) THEN RAISE EXCEPTION 'Chat is read-only'; END IF;
    IF char_length(v_body) > 4000 THEN RAISE EXCEPTION 'Message is too long'; END IF;
    IF v_body = '' AND p_activity IS NULL AND p_workout IS NULL THEN RAISE EXCEPTION 'Message is empty'; END IF;
    IF p_activity IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.id = p_activity AND a.user_id = r.rider_id) THEN
        RAISE EXCEPTION 'Invalid link';
    END IF;
    IF p_workout IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.planned_workouts w WHERE w.id = p_workout AND w.rider_id = r.rider_id) THEN
        RAISE EXCEPTION 'Invalid link';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('chatlog:' || v_me::TEXT));
    IF (SELECT count(*) FROM public.chat_log WHERE user_id = v_me AND created_at > NOW() - INTERVAL '1 hour') >= 60 THEN
        RAISE EXCEPTION 'Too many messages, try again later';
    END IF;
    INSERT INTO public.chat_log (user_id) VALUES (v_me);

    INSERT INTO public.chat_threads (id, coach_id, rider_id) VALUES (r.id, r.coach_id, r.rider_id) ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.chat_messages (thread_id, sender_id, body, activity_id, planned_workout_id)
        VALUES (r.id, v_me, v_body, p_activity, p_workout) RETURNING id INTO v_id;
    UPDATE public.chat_threads SET last_message_at = NOW() WHERE id = r.id;
    INSERT INTO public.chat_reads (thread_id, user_id) VALUES (r.id, v_me)
        ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = NOW();

    v_to := CASE WHEN v_me = r.coach_id THEN r.rider_id ELSE r.coach_id END;
    INSERT INTO public.notifications (user_id, actor_id, type) VALUES (v_to, v_me, 'coach_message')
        ON CONFLICT (user_id, actor_id) WHERE type = 'coach_message' AND read_at IS NULL
        DO UPDATE SET created_at = NOW();
    RETURN v_id;
END $$;

NOTIFY pgrst, 'reload schema';
