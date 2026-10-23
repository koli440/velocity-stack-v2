-- "Continue with Google": profile row for accounts created through OAuth.
--
-- Email signup sends first_name / last_name (register form). Google sends given_name / family_name /
-- full_name / name / picture instead, so handle_new_user now also understands those. Precedence per field:
--   first_name: first_name, given_name; last_name: last_name, family_name;
--   when both are still empty: full_name / name is split on the first space (rest = last name);
--   nickname: nickname, else (no names at all) the e-mail local part, as before.
-- Names are not unique in the profile model, so duplicate names ("John Smith") need no handling.
-- profiles.avatar_url only accepts images in the rider's own folder of the avatars bucket (CHECK constraint),
-- so Google's external picture URL is deliberately not copied; the UI falls back to initials.
-- Everything else a form would collect has column defaults. The onboarding row (welcome tour + checklist) is
-- created by the existing AFTER INSERT trigger on public.profiles, so Google users get it like email users.
-- Idempotent (CREATE OR REPLACE; the trigger is recreated unchanged).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_meta JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
    v_first TEXT := COALESCE(NULLIF(btrim(v_meta->>'first_name'), ''), NULLIF(btrim(v_meta->>'given_name'), ''));
    v_last TEXT := COALESCE(NULLIF(btrim(v_meta->>'last_name'), ''), NULLIF(btrim(v_meta->>'family_name'), ''));
    v_full TEXT := COALESCE(NULLIF(btrim(v_meta->>'full_name'), ''), NULLIF(btrim(v_meta->>'name'), ''));
    v_nick TEXT := NULLIF(btrim(v_meta->>'nickname'), '');
BEGIN
    IF v_first IS NULL AND v_last IS NULL AND v_full IS NOT NULL THEN
        v_first := split_part(v_full, ' ', 1);
        v_last := NULLIF(btrim(substr(v_full, length(split_part(v_full, ' ', 1)) + 1)), '');
    END IF;
    IF v_nick IS NULL AND v_first IS NULL AND v_last IS NULL THEN
        v_nick := NULLIF(left(split_part(COALESCE(NEW.email, ''), '@', 1), 40), '');
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, nickname)
    VALUES (NEW.id, left(v_first, 100), left(v_last, 100), left(v_nick, 40))
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
