-- Fix: admins were never notified of suggestions (#179).
-- 1) No profile was an admin. 2) The notify trigger excluded the submitter, so an
-- admin's own suggestions notified nobody.

-- Runs as postgres/service role (migration), which protect_admin_flag allows.
UPDATE public.profiles p
SET is_admin = TRUE
FROM auth.users u
WHERE u.id = p.id
  AND lower(u.email) = 'koli440@gmail.com'
  AND NOT p.is_admin;

CREATE OR REPLACE FUNCTION public.notify_admins_of_suggestion()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.notifications (user_id, actor_id, type, suggestion_id)
    SELECT p.id, NEW.submitter_id, 'suggestion_submitted', NEW.id
    FROM public.profiles p
    WHERE p.is_admin;
    RETURN NEW;
END;
$$;

-- Backfill: pending suggestions with no notification yet for a current admin.
INSERT INTO public.notifications (user_id, actor_id, type, suggestion_id)
SELECT p.id, s.submitter_id, 'suggestion_submitted', s.id
FROM public.suggestions s
CROSS JOIN public.profiles p
WHERE s.status = 'pending'
  AND p.is_admin
  AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = p.id
        AND n.suggestion_id = s.id
        AND n.type = 'suggestion_submitted'
  );
