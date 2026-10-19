-- Follow notifications: at most one unread new_follower / follow_request / follow_approved per
-- (recipient, actor), and none across a block. Stops follow/unfollow/refollow spam.
-- Applies to every insert path (triggers and the approve_follow_request RPC) without redefining them.

CREATE OR REPLACE FUNCTION public.dedupe_follow_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.type NOT IN ('new_follower', 'follow_request', 'follow_approved') OR NEW.actor_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF public.is_blocked_between(NEW.user_id, NEW.actor_id) THEN
        RETURN NULL;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id = NEW.user_id AND actor_id = NEW.actor_id AND type = NEW.type AND read_at IS NULL
    ) THEN
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dedupe_follow_notifications ON public.notifications;
CREATE TRIGGER trg_dedupe_follow_notifications
    BEFORE INSERT ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.dedupe_follow_notifications();
