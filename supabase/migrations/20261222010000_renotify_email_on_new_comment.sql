-- A new comment/mention that refreshes an existing unread notification must be emailed again.
CREATE OR REPLACE FUNCTION public.reset_notification_emailed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.comment_id IS DISTINCT FROM OLD.comment_id AND NEW.read_at IS NULL THEN
        NEW.emailed_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_notification_emailed ON public.notifications;
CREATE TRIGGER trg_reset_notification_emailed
    BEFORE UPDATE ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.reset_notification_emailed();
