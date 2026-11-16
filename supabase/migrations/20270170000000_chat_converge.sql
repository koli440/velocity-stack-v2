-- Convergence: re-create the final form of the chat RPCs under a new, highest version. Several chat migrations were
-- renumbered (duplicate versions), so a database may have skipped or mis-ordered them and still run the old flag-gated
-- chat_thread_access/chat_messages_list. Idempotent; safe to re-run. Never rename an applied migration.

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

CREATE OR REPLACE FUNCTION public.chat_reference_candidates(p_thread UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_rider UUID;
BEGIN
    IF public.chat_thread_access(p_thread) IS DISTINCT FROM 'rw' THEN RETURN NULL; END IF;
    SELECT rider_id INTO v_rider FROM public.coaching_relationships WHERE id = p_thread;
    RETURN jsonb_build_object(
        'activities', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'date', a.activity_date) ORDER BY a.activity_date DESC, a.created_at DESC)
                                FROM (SELECT * FROM public.activities WHERE user_id = v_rider ORDER BY activity_date DESC, created_at DESC LIMIT 20) a), '[]'::JSONB),
        'workouts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'date', w.workout_date) ORDER BY w.workout_date DESC)
                              FROM (SELECT * FROM public.planned_workouts WHERE rider_id = v_rider ORDER BY workout_date DESC LIMIT 20) w), '[]'::JSONB));
END $$;

-- Grants (functions keep them on replace, but re-apply so a drifted database converges).
DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY['chat_threads_summary()', 'chat_messages_list(uuid, timestamptz, integer)', 'send_chat_message(uuid, text, uuid, uuid)',
                             'mark_chat_read(uuid)', 'chat_reference_candidates(uuid)', 'edit_chat_message(uuid, text)', 'delete_chat_message(uuid)']
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.chat_thread_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_thread_access(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
