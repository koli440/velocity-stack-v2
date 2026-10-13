-- VelocityStack: blocking, follow requests, notifications, public-by-default (issue #49)
--
-- * blocks: a blocker hides themselves (and their activities) from the blocked rider and
--   vice versa; blocking removes follows and pending requests in both directions
-- * profiles.require_follow_approval: optional per-user setting (default off). When on,
--   riders must send a follow request that the owner approves or declines
-- * follow_requests: pending requests, approved through approve_follow_request()
-- * notifications: new follower / follow request / request approved, written by triggers
-- * activities.visibility now defaults to 'public' for NEW rows; existing rows are untouched
-- * RLS: shared activities are never visible across a block (either direction)

-- 1. Settings + blocks + requests ------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS require_follow_approval BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.blocks (
    blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON public.blocks(blocked_id);

CREATE TABLE IF NOT EXISTS public.follow_requests (
    requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (requester_id, target_id),
    CHECK (requester_id <> target_id)
);
CREATE INDEX IF NOT EXISTS idx_follow_requests_target ON public.follow_requests(target_id);

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('new_follower', 'follow_request', 'follow_approved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notifications_user
    ON public.notifications(user_id, created_at DESC);

-- 2. Helper functions (SECURITY DEFINER so policies can read tables the viewer can't) ---
CREATE OR REPLACE FUNCTION public.is_blocked_between(a UUID, b UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.blocks
        WHERE (blocker_id = a AND blocked_id = b) OR (blocker_id = b AND blocked_id = a)
    )
$$;

CREATE OR REPLACE FUNCTION public.requires_follow_approval(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((SELECT require_follow_approval FROM public.profiles WHERE id = p_user), FALSE)
$$;

REVOKE ALL ON FUNCTION public.is_blocked_between(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.requires_follow_approval(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_blocked_between(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.requires_follow_approval(UUID) TO authenticated;

-- 3. RLS: blocks ----------------------------------------------------------------------
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocks_select_own" ON public.blocks;
CREATE POLICY "blocks_select_own" ON public.blocks FOR SELECT USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "blocks_insert_own" ON public.blocks;
CREATE POLICY "blocks_insert_own" ON public.blocks FOR INSERT WITH CHECK (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "blocks_delete_own" ON public.blocks;
CREATE POLICY "blocks_delete_own" ON public.blocks FOR DELETE USING (auth.uid() = blocker_id);

GRANT SELECT, INSERT, DELETE ON public.blocks TO authenticated;

-- Blocking removes follows and pending requests in both directions, plus the related
-- notifications the blocker received from that rider.
CREATE OR REPLACE FUNCTION public.handle_block_created()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    DELETE FROM public.follows
        WHERE (follower_id = NEW.blocker_id AND followee_id = NEW.blocked_id)
           OR (follower_id = NEW.blocked_id AND followee_id = NEW.blocker_id);
    DELETE FROM public.follow_requests
        WHERE (requester_id = NEW.blocker_id AND target_id = NEW.blocked_id)
           OR (requester_id = NEW.blocked_id AND target_id = NEW.blocker_id);
    DELETE FROM public.notifications
        WHERE (user_id = NEW.blocker_id AND actor_id = NEW.blocked_id)
           OR (user_id = NEW.blocked_id AND actor_id = NEW.blocker_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_created ON public.blocks;
CREATE TRIGGER trg_block_created
    AFTER INSERT ON public.blocks
    FOR EACH ROW EXECUTE FUNCTION public.handle_block_created();

-- 4. RLS: follows (can't follow across a block or around the approval setting) ---------
DROP POLICY IF EXISTS "follows_insert_own" ON public.follows;
CREATE POLICY "follows_insert_own"
    ON public.follows FOR INSERT
    WITH CHECK (
        auth.uid() = follower_id
        AND NOT public.is_blocked_between(follower_id, followee_id)
        AND NOT public.requires_follow_approval(followee_id)
    );

-- 5. RLS: follow requests -------------------------------------------------------------
ALTER TABLE public.follow_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "follow_requests_select_involved" ON public.follow_requests;
CREATE POLICY "follow_requests_select_involved"
    ON public.follow_requests FOR SELECT
    USING (auth.uid() = requester_id OR auth.uid() = target_id);

DROP POLICY IF EXISTS "follow_requests_insert_own" ON public.follow_requests;
CREATE POLICY "follow_requests_insert_own"
    ON public.follow_requests FOR INSERT
    WITH CHECK (
        auth.uid() = requester_id
        AND public.requires_follow_approval(target_id)
        AND NOT public.is_blocked_between(requester_id, target_id)
        AND NOT EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = requester_id AND f.followee_id = target_id
        )
    );

-- Requester cancels, target declines.
DROP POLICY IF EXISTS "follow_requests_delete_involved" ON public.follow_requests;
CREATE POLICY "follow_requests_delete_involved"
    ON public.follow_requests FOR DELETE
    USING (auth.uid() = requester_id OR auth.uid() = target_id);

GRANT SELECT, INSERT, DELETE ON public.follow_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_follow_request(p_requester UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.follow_requests
        WHERE requester_id = p_requester AND target_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'No such follow request';
    END IF;
    IF public.is_blocked_between(p_requester, auth.uid()) THEN
        DELETE FROM public.follow_requests
            WHERE requester_id = p_requester AND target_id = auth.uid();
        RAISE EXCEPTION 'No such follow request';
    END IF;

    -- The approver already saw the request, so skip the "new follower" notification.
    PERFORM set_config('app.skip_follow_notice', '1', TRUE);
    INSERT INTO public.follows (follower_id, followee_id)
        VALUES (p_requester, auth.uid())
        ON CONFLICT DO NOTHING;
    PERFORM set_config('app.skip_follow_notice', '0', TRUE);

    DELETE FROM public.follow_requests
        WHERE requester_id = p_requester AND target_id = auth.uid();
    INSERT INTO public.notifications (user_id, actor_id, type)
        VALUES (p_requester, auth.uid(), 'follow_approved');
END;
$$;

REVOKE ALL ON FUNCTION public.approve_follow_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_follow_request(UUID) TO authenticated;

-- 6. Notifications --------------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
    ON public.notifications FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
    ON public.notifications FOR UPDATE
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own"
    ON public.notifications FOR DELETE USING (auth.uid() = user_id);

-- Rows are only ever created by the triggers below (no INSERT policy for clients).
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_new_follower()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF COALESCE(current_setting('app.skip_follow_notice', TRUE), '0') <> '1' THEN
        INSERT INTO public.notifications (user_id, actor_id, type)
            VALUES (NEW.followee_id, NEW.follower_id, 'new_follower');
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_follower ON public.follows;
CREATE TRIGGER trg_notify_new_follower
    AFTER INSERT ON public.follows
    FOR EACH ROW EXECUTE FUNCTION public.notify_new_follower();

CREATE OR REPLACE FUNCTION public.notify_follow_request()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.notifications (user_id, actor_id, type)
        VALUES (NEW.target_id, NEW.requester_id, 'follow_request');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_follow_request ON public.follow_requests;
CREATE TRIGGER trg_notify_follow_request
    AFTER INSERT ON public.follow_requests
    FOR EACH ROW EXECUTE FUNCTION public.notify_follow_request();

-- A cancelled/declined/approved request no longer needs its notification.
CREATE OR REPLACE FUNCTION public.clear_follow_request_notice()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    DELETE FROM public.notifications
        WHERE user_id = OLD.target_id AND actor_id = OLD.requester_id AND type = 'follow_request';
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_follow_request_notice ON public.follow_requests;
CREATE TRIGGER trg_clear_follow_request_notice
    AFTER DELETE ON public.follow_requests
    FOR EACH ROW EXECUTE FUNCTION public.clear_follow_request_notice();

-- 7. Visibility: public by default for new rows; existing rows keep their value -------
ALTER TABLE public.activities ALTER COLUMN visibility SET DEFAULT 'public';

-- Shared activities are never visible across a block (either direction).
DROP POLICY IF EXISTS "activities_select_shared" ON public.activities;
CREATE POLICY "activities_select_shared"
    ON public.activities FOR SELECT
    TO authenticated
    USING (
        NOT public.is_blocked_between(auth.uid(), user_id)
        AND (
            visibility = 'public'
            OR (
                visibility = 'followers'
                AND EXISTS (
                    SELECT 1 FROM public.follows f
                    WHERE f.follower_id = auth.uid() AND f.followee_id = activities.user_id
                )
            )
        )
    );

-- 8. public_profiles: hide riders who blocked the viewer; expose the approval flag -----
-- (The blocker still sees the riders they blocked so they can unblock them.)
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles AS
    SELECT
        p.id,
        COALESCE(NULLIF(p.nickname, ''), NULLIF(p.first_name, '')) AS username,
        NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '') AS full_name,
        NULL::text AS avatar_url,
        p.require_follow_approval
    FROM public.profiles p
    WHERE NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE b.blocker_id = p.id AND b.blocked_id = auth.uid()
    );

GRANT SELECT ON public.public_profiles TO authenticated;
