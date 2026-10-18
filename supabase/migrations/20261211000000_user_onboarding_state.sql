-- Onboarding and "What's new" state (issue #244): one private row per user.
--
--  * welcome_seen_at           the welcome tour was finished or skipped (NULL = show it once).
--  * onboarding_dismissed_at   the getting-started checklist was dismissed (NULL = show it on the dashboard).
--  * news_seen_through         id of the newest news entry the user has seen. News ids start with their
--                              date (YYYY-MM-DD-slug), so "unseen" is a plain string comparison
--                              (id > news_seen_through). It can only move forward.
--
--  * Personal UI state: RLS lets a user read and update ONLY their own row. There is deliberately no coach
--    policy, no admin policy and no delete/insert grant for clients: rows are created by the signup trigger
--    (new accounts start with the tour pending and "news seen up to now" so they do not get the backlog) or
--    by ensure_my_onboarding_state(), which only ever creates the caller's own row.
--  * Existing accounts are initialised once as "news seen up to now" and onboarding dismissed, so nobody is
--    forced through onboarding. Re-running the migration never touches existing rows.
--  * Checklist progress is NOT stored: it is derived client-side from real data.

-- 1. Table ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_onboarding_state (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    welcome_seen_at TIMESTAMPTZ,
    onboarding_dismissed_at TIMESTAMPTZ,
    news_seen_through TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_onboarding_news_len CHECK (char_length(news_seen_through) <= 120)
);

-- "Seen up to now": every id dated on or before today sorts below this ('~' sorts after letters, digits, '-').
-- The floor is this migration's date, so the entries seeded with the feature (dated up to then) count as
-- seen for existing accounts even if the clock is behind the migration timestamp.
CREATE OR REPLACE FUNCTION public.onboarding_news_today()
RETURNS TEXT
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT GREATEST(to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), '2026-12-11') || '~'
$$;

-- 2. Initialise existing accounts (idempotent: only accounts without a row) -------------------
INSERT INTO public.user_onboarding_state (user_id, welcome_seen_at, onboarding_dismissed_at, news_seen_through)
SELECT p.id, NOW(), NOW(), public.onboarding_news_today()
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;

-- 3. Row level security ----------------------------------------------------------------------
ALTER TABLE public.user_onboarding_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_onboarding_select_own" ON public.user_onboarding_state;
CREATE POLICY "user_onboarding_select_own" ON public.user_onboarding_state
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_onboarding_update_own" ON public.user_onboarding_state;
CREATE POLICY "user_onboarding_update_own" ON public.user_onboarding_state
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.user_onboarding_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_onboarding_state TO authenticated;
GRANT UPDATE (welcome_seen_at, onboarding_dismissed_at, news_seen_through) ON public.user_onboarding_state TO authenticated;

-- 4. News marker only moves forward; updated_at is server-stamped ----------------------------
CREATE OR REPLACE FUNCTION public.user_onboarding_state_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.news_seen_through < OLD.news_seen_through THEN
        NEW.news_seen_through := OLD.news_seen_through;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.user_onboarding_state_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_onboarding_state_guard ON public.user_onboarding_state;
CREATE TRIGGER user_onboarding_state_guard
    BEFORE UPDATE ON public.user_onboarding_state
    FOR EACH ROW EXECUTE FUNCTION public.user_onboarding_state_guard();

-- 5. New accounts: tour pending, no news backlog ---------------------------------------------
CREATE OR REPLACE FUNCTION public.user_onboarding_state_for_new_profile()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.user_onboarding_state (user_id, news_seen_through)
    VALUES (NEW.id, public.onboarding_news_today())
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.user_onboarding_state_for_new_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_onboarding_state_new_profile ON public.profiles;
CREATE TRIGGER user_onboarding_state_new_profile
    AFTER INSERT ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.user_onboarding_state_for_new_profile();

-- 6. Safety net: the caller's own row, created on demand (treated as a new account) ------------
CREATE OR REPLACE FUNCTION public.ensure_my_onboarding_state()
RETURNS public.user_onboarding_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row public.user_onboarding_state;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    INSERT INTO public.user_onboarding_state (user_id, news_seen_through)
    SELECT p.id, public.onboarding_news_today() FROM public.profiles p WHERE p.id = auth.uid()
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_row FROM public.user_onboarding_state WHERE user_id = auth.uid();
    RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_my_onboarding_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_onboarding_state() TO authenticated;
