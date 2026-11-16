-- VelocityStack coach module, piece 2: 1:1 coach <-> rider chat (behind the `coach_module` flag).
--
--  * One thread per coaching relationship (thread id = relationship id). A new relationship with the same
--    pair starts a new thread.
--  * Active relationship: both sides read and send. After it ended the RIDER keeps read access, the coach
--    loses access immediately; nobody can send. Blocks deny everything.
--  * Writes only via RPCs; client SELECT on chat_messages is a participant-only policy so Supabase realtime
--    can deliver events (the UI uses them as a signal and re-reads through chat_messages_list()).
--  * Text (<= 4000), optional link to one of the RIDER's activities / planned workouts. Edit within 10
--    minutes, soft delete (body and links removed). 60 messages per hour per user.
--  * Notification 'coach_message' (collapsed: one unread per sender/recipient; push and email reuse the
--    existing delivery jobs and never contain message text).
--  * Reports keep a snapshot of the message body; admins see only reported messages.
--  * Attachments are NOT part of this migration (see docs/coaching.md).
-- All objects are additive and idempotent.

CREATE TABLE IF NOT EXISTS public.chat_threads (
    id UUID PRIMARY KEY REFERENCES public.coaching_relationships(id) ON DELETE CASCADE,
    coach_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
    activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
    planned_workout_id UUID REFERENCES public.planned_workouts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON public.chat_messages (thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_reads (
    thread_id UUID NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chat_log (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_log ON public.chat_log (user_id, created_at);

CREATE TABLE IF NOT EXISTS public.chat_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
    thread_id UUID NOT NULL,
    reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL,
    body_snapshot TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_reports_once ON public.chat_reports (message_id, reporter_id) WHERE message_id IS NOT NULL;

ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_threads, public.chat_messages, public.chat_reads, public.chat_log, public.chat_reports
    FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_coach_message_unread
    ON public.notifications (user_id, actor_id)
    WHERE type = 'coach_message' AND read_at IS NULL;

-- Access: 'rw' | 'r' | NULL for the signed-in user on a thread (internal, also used by the realtime policy).
CREATE OR REPLACE FUNCTION public.chat_thread_access(p_thread UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    t public.chat_threads;
    r public.coaching_relationships;
BEGIN
    IF v_me IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO t FROM public.chat_threads WHERE id = p_thread;
    IF NOT FOUND OR v_me NOT IN (t.coach_id, t.rider_id) THEN RETURN NULL; END IF;
    SELECT * INTO r FROM public.coaching_relationships WHERE id = p_thread;
    IF NOT FOUND OR NOT public.coach_module_enabled(t.coach_id) OR public.is_blocked_between(t.coach_id, t.rider_id) THEN RETURN NULL; END IF;
    IF r.status = 'active' THEN RETURN 'rw'; END IF;
    IF r.status = 'ended' AND v_me = t.rider_id THEN RETURN 'r'; END IF;
    RETURN NULL;
END $$;

DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
CREATE POLICY chat_messages_select ON public.chat_messages FOR SELECT TO authenticated
    USING (public.chat_thread_access(thread_id) IS NOT NULL);
GRANT SELECT ON public.chat_messages TO authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
    END IF;
END $$;

-- Threads of the caller (active relationships even before the first message) with unread counts.
CREATE OR REPLACE FUNCTION public.chat_threads_summary()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.coach_module_require_any();
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
              AND public.coach_module_enabled(r.coach_id)
              AND NOT public.is_blocked_between(r.coach_id, r.rider_id)
              AND (r.status = 'active' OR (r.status = 'ended' AND r.rider_id = v_me AND t.id IS NOT NULL))
        ) s), '[]'::JSONB);
END $$;

CREATE OR REPLACE FUNCTION public.chat_messages_list(p_thread UUID, p_before TIMESTAMPTZ DEFAULT NULL, p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_access TEXT := public.chat_thread_access(p_thread);
    v_rider UUID;
BEGIN
    IF v_access IS NULL THEN RETURN NULL; END IF;
    SELECT rider_id INTO v_rider FROM public.chat_threads WHERE id = p_thread;
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

-- Send (creates the thread on first use; the thread id is the relationship id).
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
    IF NOT public.coach_module_enabled(r.coach_id) THEN RAISE EXCEPTION 'Coach module is not enabled'; END IF;
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

CREATE OR REPLACE FUNCTION public.edit_chat_message(p_id UUID, p_body TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    m public.chat_messages;
    v_body TEXT := btrim(COALESCE(p_body, ''));
BEGIN
    SELECT * INTO m FROM public.chat_messages WHERE id = p_id AND sender_id = auth.uid() FOR UPDATE;
    IF NOT FOUND OR m.deleted_at IS NOT NULL OR public.chat_thread_access(m.thread_id) IS DISTINCT FROM 'rw' THEN RAISE EXCEPTION 'Message not found'; END IF;
    IF m.created_at < NOW() - INTERVAL '10 minutes' THEN RAISE EXCEPTION 'Messages can only be edited for 10 minutes'; END IF;
    IF char_length(v_body) > 4000 OR (v_body = '' AND m.activity_id IS NULL AND m.planned_workout_id IS NULL) THEN RAISE EXCEPTION 'Invalid message'; END IF;
    UPDATE public.chat_messages SET body = v_body, edited_at = NOW() WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION public.delete_chat_message(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    m public.chat_messages;
BEGIN
    SELECT * INTO m FROM public.chat_messages WHERE id = p_id AND sender_id = auth.uid() FOR UPDATE;
    IF NOT FOUND OR public.chat_thread_access(m.thread_id) IS DISTINCT FROM 'rw' THEN RAISE EXCEPTION 'Message not found'; END IF;
    UPDATE public.chat_messages SET body = '', activity_id = NULL, planned_workout_id = NULL, deleted_at = COALESCE(deleted_at, NOW()) WHERE id = p_id;
END $$;

-- Marks the thread read for the caller and clears the collapsed notification from the other side.
CREATE OR REPLACE FUNCTION public.mark_chat_read(p_thread UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    t public.chat_threads;
BEGIN
    IF public.chat_thread_access(p_thread) IS NULL THEN RETURN; END IF;
    SELECT * INTO t FROM public.chat_threads WHERE id = p_thread;
    INSERT INTO public.chat_reads (thread_id, user_id) VALUES (p_thread, auth.uid())
        ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = NOW();
    UPDATE public.notifications SET read_at = NOW()
        WHERE user_id = auth.uid() AND type = 'coach_message' AND read_at IS NULL
          AND actor_id = CASE WHEN auth.uid() = t.coach_id THEN t.rider_id ELSE t.coach_id END;
END $$;

CREATE OR REPLACE FUNCTION public.report_chat_message(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    m public.chat_messages;
    v_reason TEXT := btrim(COALESCE(p_reason, ''));
BEGIN
    SELECT * INTO m FROM public.chat_messages WHERE id = p_id;
    IF NOT FOUND OR m.deleted_at IS NOT NULL OR m.sender_id = auth.uid() OR public.chat_thread_access(m.thread_id) IS NULL THEN
        RAISE EXCEPTION 'Message not found';
    END IF;
    IF v_reason = '' OR char_length(v_reason) > 500 THEN RAISE EXCEPTION 'Please give a reason (max 500 characters)'; END IF;
    IF (SELECT count(*) FROM public.chat_reports WHERE reporter_id = auth.uid() AND created_at > NOW() - INTERVAL '1 day') >= 10 THEN
        RAISE EXCEPTION 'Too many reports today';
    END IF;
    INSERT INTO public.chat_reports (message_id, thread_id, reporter_id, sender_id, body_snapshot, reason)
        VALUES (m.id, m.thread_id, auth.uid(), m.sender_id, m.body, v_reason)
        ON CONFLICT (message_id, reporter_id) WHERE message_id IS NOT NULL DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.admin_chat_reports()
RETURNS TABLE (id UUID, reason TEXT, body_snapshot TEXT, status TEXT, created_at TIMESTAMPTZ, reporter_name TEXT, sender_name TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
    RETURN QUERY
        SELECT r.id, r.reason, r.body_snapshot, r.status, r.created_at,
               public.profile_display_name(a.nickname, a.first_name, a.last_name),
               public.profile_display_name(b.nickname, b.first_name, b.last_name)
        FROM public.chat_reports r
        LEFT JOIN public.profiles a ON a.id = r.reporter_id
        LEFT JOIN public.profiles b ON b.id = r.sender_id
        ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 200;
END $$;

CREATE OR REPLACE FUNCTION public.admin_resolve_chat_report(p_id UUID, p_action_taken BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
    UPDATE public.chat_reports SET status = CASE WHEN COALESCE(p_action_taken, FALSE) THEN 'resolved' ELSE 'dismissed' END, resolved_at = NOW()
        WHERE id = p_id AND status = 'open';
    IF NOT FOUND THEN RAISE EXCEPTION 'Report not found'; END IF;
END $$;

-- Rider export of a thread (plain rows, oldest first); also available to the coach while the thread is active.
CREATE OR REPLACE FUNCTION public.chat_export(p_thread UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF public.chat_thread_access(p_thread) IS NULL THEN RETURN NULL; END IF;
    RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('at', m.created_at, 'sender_id', m.sender_id, 'body', m.body) ORDER BY m.created_at)
                     FROM public.chat_messages m WHERE m.thread_id = p_thread AND m.deleted_at IS NULL), '[]'::JSONB);
END $$;

-- Module check for list endpoints: allows users on either side of a module-enabled coach; here: the caller or any coach they have.
CREATE OR REPLACE FUNCTION public.coach_module_require_any()
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT (public.coach_module_enabled(auth.uid()) OR EXISTS (
        SELECT 1 FROM public.coaching_relationships r
        WHERE auth.uid() IN (r.coach_id, r.rider_id) AND public.coach_module_enabled(r.coach_id))) THEN
        RAISE EXCEPTION 'Coach module is not enabled';
    END IF;
END $$;

REVOKE ALL ON FUNCTION public.chat_thread_access(UUID), public.coach_module_require_any() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_thread_access(UUID) TO authenticated;
DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'chat_threads_summary()', 'chat_messages_list(uuid, timestamptz, integer)', 'send_chat_message(uuid, text, uuid, uuid)',
        'edit_chat_message(uuid, text)', 'delete_chat_message(uuid)', 'mark_chat_read(uuid)', 'report_chat_message(uuid, text)',
        'admin_chat_reports()', 'admin_resolve_chat_report(uuid, boolean)', 'chat_export(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
