-- VelocityStack: activity comments (schema, RLS, rate limit, mentions, notifications)
--
-- * Flat comment stream per activity; nullable reply_to is reserved for threading later.
-- * Who may read/write: everybody who can see the activity -- the owner, the owner's active
--   coach (also on private activities; such a thread is visible to owner + coach only) and
--   other riders per activities.visibility. Blocks (either direction) always win.
-- * Comments are retained when an activity goes private again: the owner (and coach) keep
--   access, everybody else loses it together with access to the activity.
-- * Writes only through SECURITY DEFINER RPCs (rate limit 30/hour/user, @mention parsing,
--   notifications). Clients can only SELECT.
-- * activities.comments_enabled (default TRUE, also for existing rows) lets the owner switch
--   new comments off; existing comments stay readable.
-- * Notifications are in-app only: activity_comment (owner, coach, earlier commenters; one
--   unread per user + activity) and comment_mention (only users who can see the activity).

-- 1. Activity switch -----------------------------------------------------------------------
ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS comments_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Tables --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
    reply_to UUID REFERENCES public.activity_comments(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_activity_comments_activity
    ON public.activity_comments (activity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_comments_user
    ON public.activity_comments (user_id);

CREATE TABLE IF NOT EXISTS public.activity_comment_mentions (
    comment_id UUID NOT NULL REFERENCES public.activity_comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_comment_mentions_user
    ON public.activity_comment_mentions (user_id);

-- Rate-limit log: survives comment deletion so deleting cannot be used to dodge the limit.
CREATE TABLE IF NOT EXISTS public.activity_comment_log (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_comment_log_user
    ON public.activity_comment_log (user_id, created_at DESC);

ALTER TABLE public.activity_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_comment_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_comment_log ENABLE ROW LEVEL SECURITY;

-- 3. Notifications -------------------------------------------------------------------------
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS activity_id UUID REFERENCES public.activities(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS comment_id UUID REFERENCES public.activity_comments(id) ON DELETE CASCADE;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'new_follower', 'follow_request', 'follow_approved',
        'suggestion_submitted', 'suggestion_approved', 'suggestion_rejected',
        'coach_invite', 'coach_request', 'coach_accepted', 'coach_ended', 'coach_replaced',
        'coach_edited',
        'activity_comment', 'comment_mention'
    ));

-- One unread notification per user + activity (+ type): later comments bump it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_activity_comment_unread
    ON public.notifications (user_id, activity_id, type)
    WHERE type IN ('activity_comment', 'comment_mention') AND read_at IS NULL;

-- 4. Access helpers ------------------------------------------------------------------------
-- Can p_user see p_activity? (Not callable by clients: they could probe other riders.)
CREATE OR REPLACE FUNCTION public.user_can_view_activity(p_user UUID, p_activity UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p_user IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.activities a
        WHERE a.id = p_activity
          AND (
              a.user_id = p_user
              OR (
                  NOT public.is_blocked_between(p_user, a.user_id)
                  AND (
                      a.visibility = 'public'
                      OR (a.visibility = 'followers' AND EXISTS (
                          SELECT 1 FROM public.follows f
                          WHERE f.follower_id = p_user AND f.followee_id = a.user_id))
                      OR EXISTS (
                          SELECT 1 FROM public.coaching_relationships c
                          WHERE c.coach_id = p_user AND c.rider_id = a.user_id
                            AND c.status = 'active')
                  )
              )
          )
    )
$$;
REVOKE ALL ON FUNCTION public.user_can_view_activity(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Signed-in user can see the activity (and therefore its comments).
CREATE OR REPLACE FUNCTION public.can_view_activity_comments(p_activity UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT public.user_can_view_activity(auth.uid(), p_activity)
$$;
REVOKE ALL ON FUNCTION public.can_view_activity_comments(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_activity_comments(UUID) TO authenticated;

-- 5. RLS: read only for clients ------------------------------------------------------------
DROP POLICY IF EXISTS "activity_comments_select" ON public.activity_comments;
CREATE POLICY "activity_comments_select" ON public.activity_comments
    FOR SELECT TO authenticated
    USING (public.can_view_activity_comments(activity_id));

DROP POLICY IF EXISTS "activity_comment_mentions_select" ON public.activity_comment_mentions;
CREATE POLICY "activity_comment_mentions_select" ON public.activity_comment_mentions
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.activity_comments c
        WHERE c.id = comment_id AND public.can_view_activity_comments(c.activity_id)));

REVOKE ALL ON public.activity_comments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.activity_comment_mentions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.activity_comment_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.activity_comments TO authenticated;
GRANT SELECT ON public.activity_comment_mentions TO authenticated;

-- 6. Mentions + notifications --------------------------------------------------------------
-- Replaces the comment's mentions with the @handles found in its body (handle = nickname,
-- case-insensitive) and returns the user ids that are NEW. Only riders who can see the
-- activity (blocks included) can be mentioned; the author never mentions themselves.
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
        SELECT DISTINCT lower(regexp_replace(m[1], '[.-]+$', '')) AS handle
        FROM regexp_matches(c.body, '(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_.-]{1,40})', 'g') AS m
        LIMIT 10
    ) h
    JOIN public.profiles p ON lower(p.nickname) = h.handle
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

CREATE OR REPLACE FUNCTION public.notify_comment_users(
    p_comment UUID, p_new_mentions UUID[], p_notify_activity BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c public.activity_comments;
    v_owner UUID;
    r RECORD;
BEGIN
    SELECT * INTO c FROM public.activity_comments WHERE id = p_comment;
    SELECT user_id INTO v_owner FROM public.activities WHERE id = c.activity_id;

    FOR r IN SELECT unnest(p_new_mentions) AS uid LOOP
        INSERT INTO public.notifications (user_id, actor_id, type, activity_id, comment_id)
            VALUES (r.uid, c.user_id, 'comment_mention', c.activity_id, c.id)
            ON CONFLICT (user_id, activity_id, type)
                WHERE type IN ('activity_comment', 'comment_mention') AND read_at IS NULL
            DO UPDATE SET actor_id = EXCLUDED.actor_id, comment_id = EXCLUDED.comment_id,
                          created_at = NOW();
    END LOOP;

    IF NOT p_notify_activity THEN
        RETURN;
    END IF;

    -- Owner, the owner's active coach and everybody who commented before.
    FOR r IN
        SELECT DISTINCT t.uid FROM (
            SELECT v_owner AS uid
            UNION
            SELECT coach_id FROM public.coaching_relationships
                WHERE rider_id = v_owner AND status = 'active'
            UNION
            SELECT user_id FROM public.activity_comments WHERE activity_id = c.activity_id
        ) t
        WHERE t.uid <> c.user_id
          AND NOT (t.uid = ANY (p_new_mentions))
          AND NOT public.is_blocked_between(t.uid, c.user_id)
          AND public.user_can_view_activity(t.uid, c.activity_id)
    LOOP
        INSERT INTO public.notifications (user_id, actor_id, type, activity_id, comment_id)
            VALUES (r.uid, c.user_id, 'activity_comment', c.activity_id, c.id)
            ON CONFLICT (user_id, activity_id, type)
                WHERE type IN ('activity_comment', 'comment_mention') AND read_at IS NULL
            DO UPDATE SET actor_id = EXCLUDED.actor_id, comment_id = EXCLUDED.comment_id,
                          created_at = NOW();
    END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_comment_users(UUID, UUID[], BOOLEAN) FROM PUBLIC, anon, authenticated;

-- 7. Client RPCs ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_activity_comment(
    p_activity UUID, p_body TEXT, p_reply_to UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_body TEXT := btrim(COALESCE(p_body, ''));
    v_id UUID;
    v_mentions UUID[];
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF char_length(v_body) = 0 OR char_length(v_body) > 2000 THEN
        RAISE EXCEPTION 'A comment must be 1-2000 characters';
    END IF;
    -- Hidden or missing activities look identical.
    IF NOT public.user_can_view_activity(v_me, p_activity) THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;
    IF NOT (SELECT comments_enabled FROM public.activities WHERE id = p_activity) THEN
        RAISE EXCEPTION 'Comments are turned off for this activity';
    END IF;
    IF p_reply_to IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.activity_comments WHERE id = p_reply_to AND activity_id = p_activity
    ) THEN
        RAISE EXCEPTION 'Comment to reply to not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('activity_comment:' || v_me::text));
    IF (SELECT count(*) FROM public.activity_comment_log
        WHERE user_id = v_me AND created_at > NOW() - INTERVAL '1 hour') >= 30 THEN
        RAISE EXCEPTION 'Comment limit reached (30 per hour), try again later';
    END IF;
    DELETE FROM public.activity_comment_log
        WHERE user_id = v_me AND created_at <= NOW() - INTERVAL '1 hour';
    INSERT INTO public.activity_comment_log (user_id) VALUES (v_me);

    INSERT INTO public.activity_comments (activity_id, user_id, body, reply_to)
        VALUES (p_activity, v_me, v_body, p_reply_to)
        RETURNING id INTO v_id;

    v_mentions := public.sync_comment_mentions(v_id);
    PERFORM public.notify_comment_users(v_id, v_mentions, TRUE);
    RETURN v_id;
END;
$$;

-- Authors edit their own comment (while they can still see the activity).
CREATE OR REPLACE FUNCTION public.edit_activity_comment(p_comment UUID, p_body TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_body TEXT := btrim(COALESCE(p_body, ''));
    c public.activity_comments;
    v_mentions UUID[];
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF char_length(v_body) = 0 OR char_length(v_body) > 2000 THEN
        RAISE EXCEPTION 'A comment must be 1-2000 characters';
    END IF;
    SELECT * INTO c FROM public.activity_comments WHERE id = p_comment FOR UPDATE;
    IF NOT FOUND OR c.user_id <> v_me OR NOT public.user_can_view_activity(v_me, c.activity_id) THEN
        RAISE EXCEPTION 'Comment not found';
    END IF;
    IF v_body = c.body THEN
        RETURN;
    END IF;
    UPDATE public.activity_comments SET body = v_body, edited_at = NOW() WHERE id = p_comment;
    v_mentions := public.sync_comment_mentions(p_comment);
    PERFORM public.notify_comment_users(p_comment, v_mentions, FALSE);
END;
$$;

-- The author and the activity owner can delete.
CREATE OR REPLACE FUNCTION public.delete_activity_comment(p_comment UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    DELETE FROM public.activity_comments c
    WHERE c.id = p_comment
      AND (c.user_id = v_me
           OR EXISTS (SELECT 1 FROM public.activities a
                      WHERE a.id = c.activity_id AND a.user_id = v_me));
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Comment not found';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.add_activity_comment(UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_activity_comment(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_activity_comment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_activity_comment(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_activity_comment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_activity_comment(UUID) TO authenticated;
