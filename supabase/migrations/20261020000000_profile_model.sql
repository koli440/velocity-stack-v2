-- Profile data model cleanup.
--   auth.users      = authentication only
--   public.profiles = the single source of rider data (identity: first_name, last_name,
--                     nickname; training defaults; social flags)
--   public.profile_secrets = private integration credentials (own row only)
-- Order matters: backfill names first, then structural changes. Idempotent.

-- 1. Settings --------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS discoverable_by_email BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Backfill identity (only fills blanks, never overwrites) ---------------------------
-- 2a. Missing profile rows for existing accounts (signup used to create them client-side).
INSERT INTO public.profiles (id)
SELECT u.id FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- 2b. Names from auth signup metadata when the profile has none.
UPDATE public.profiles p SET
    first_name = COALESCE(NULLIF(btrim(p.first_name), ''),
        NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'given_name')), '')),
    last_name = COALESCE(NULLIF(btrim(p.last_name), ''),
        NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'last_name', u.raw_user_meta_data->>'family_name')), '')),
    nickname = COALESCE(NULLIF(btrim(p.nickname), ''),
        NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'nickname', u.raw_user_meta_data->>'user_name',
                              u.raw_user_meta_data->>'preferred_username')), ''))
FROM auth.users u
WHERE u.id = p.id
  AND (NULLIF(btrim(p.first_name), '') IS NULL OR NULLIF(btrim(p.last_name), '') IS NULL
       OR NULLIF(btrim(p.nickname), '') IS NULL);

-- 2c. Single "full name"/"name" metadata -> first/last when there is still no name at all.
UPDATE public.profiles p SET
    first_name = split_part(btrim(n.full), ' ', 1),
    last_name = NULLIF(btrim(substr(btrim(n.full), length(split_part(btrim(n.full), ' ', 1)) + 1)), '')
FROM (
    SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name') AS full
    FROM auth.users u
) n
WHERE n.id = p.id AND NULLIF(btrim(n.full), '') IS NOT NULL
  AND NULLIF(btrim(p.first_name), '') IS NULL AND NULLIF(btrim(p.last_name), '') IS NULL
  AND NULLIF(btrim(p.nickname), '') IS NULL;

-- 2d. Still nameless (e.g. pending V1 users): use the email local-part as nickname so every
-- rider has a usable display name.
UPDATE public.profiles p SET nickname = left(split_part(u.email, '@', 1), 40)
FROM auth.users u
WHERE u.id = p.id
  AND NULLIF(btrim(p.first_name), '') IS NULL AND NULLIF(btrim(p.last_name), '') IS NULL
  AND NULLIF(btrim(p.nickname), '') IS NULL
  AND NULLIF(split_part(u.email, '@', 1), '') IS NOT NULL;

-- 3. Secrets: copy, then drop from profiles --------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_secrets (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    intervals_athlete_id TEXT,
    intervals_api_key TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.profile_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_secrets_select_own" ON public.profile_secrets;
CREATE POLICY "profile_secrets_select_own" ON public.profile_secrets FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "profile_secrets_insert_own" ON public.profile_secrets;
CREATE POLICY "profile_secrets_insert_own" ON public.profile_secrets FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "profile_secrets_update_own" ON public.profile_secrets;
CREATE POLICY "profile_secrets_update_own" ON public.profile_secrets FOR UPDATE
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "profile_secrets_delete_own" ON public.profile_secrets;
CREATE POLICY "profile_secrets_delete_own" ON public.profile_secrets FOR DELETE USING (auth.uid() = user_id);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'intervals_api_key') THEN
        EXECUTE 'INSERT INTO public.profile_secrets (user_id, intervals_athlete_id, intervals_api_key)
                 SELECT id, intervals_athlete_id, intervals_api_key FROM public.profiles
                 WHERE intervals_athlete_id IS NOT NULL OR intervals_api_key IS NOT NULL
                 ON CONFLICT (user_id) DO UPDATE
                   SET intervals_athlete_id = COALESCE(public.profile_secrets.intervals_athlete_id, EXCLUDED.intervals_athlete_id),
                       intervals_api_key = COALESCE(public.profile_secrets.intervals_api_key, EXCLUDED.intervals_api_key)';
        EXECUTE 'ALTER TABLE public.profiles DROP COLUMN IF EXISTS intervals_athlete_id, DROP COLUMN IF EXISTS intervals_api_key';
    END IF;
END $$;

-- 4. Profile row on signup ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.profiles (id, first_name, last_name, nickname)
    VALUES (
        NEW.id,
        NULLIF(btrim(NEW.raw_user_meta_data->>'first_name'), ''),
        NULLIF(btrim(NEW.raw_user_meta_data->>'last_name'), ''),
        COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'nickname'), ''),
                 CASE WHEN NULLIF(btrim(NEW.raw_user_meta_data->>'first_name'), '') IS NULL
                       AND NULLIF(btrim(NEW.raw_user_meta_data->>'last_name'), '') IS NULL
                      THEN NULLIF(left(split_part(NEW.email, '@', 1), 40), '') END)
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. One naming vocabulary: display_name / nickname / first_name / last_name -------------
CREATE OR REPLACE FUNCTION public.profile_display_name(p_nick TEXT, p_first TEXT, p_last TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT COALESCE(
        NULLIF(btrim(COALESCE(p_nick, '')), ''),
        NULLIF(btrim(COALESCE(p_first, '') || ' ' || COALESCE(p_last, '')), ''),
        'Rider')
$$;

DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles AS
    SELECT
        p.id,
        public.profile_display_name(p.nickname, p.first_name, p.last_name) AS display_name,
        p.nickname,
        p.first_name,
        p.last_name,
        p.require_follow_approval,
        p.is_bot
    FROM public.profiles p
    WHERE NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE b.blocker_id = p.id AND b.blocked_id = auth.uid()
    );
REVOKE ALL ON public.public_profiles FROM PUBLIC, anon;
GRANT SELECT ON public.public_profiles TO authenticated;

-- 6. RPCs (email matching is exact-only, server-side, never returned) --------------------
DROP FUNCTION IF EXISTS public.search_riders(TEXT, BOOLEAN, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.get_rider_profile(UUID);

CREATE FUNCTION public.search_riders(
    p_term TEXT DEFAULT '',
    p_bots_only BOOLEAN DEFAULT FALSE,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    display_name TEXT,
    nickname TEXT,
    first_name TEXT,
    last_name TEXT,
    is_bot BOOLEAN,
    require_follow_approval BOOLEAN,
    home_track_name TEXT,
    last_activity_date DATE,
    ride_count INTEGER,
    follow_status TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_me UUID := auth.uid();
    v_term TEXT := lower(btrim(COALESCE(p_term, '')));
    v_is_email BOOLEAN;
    v_email_id UUID;
    v_like TEXT;
BEGIN
    IF v_me IS NULL THEN
        RETURN;
    END IF;

    -- A full e-mail address (and nothing else) is matched exactly against auth.users.
    -- No prefix/partial matching and the address is never returned.
    v_is_email := length(v_term) BETWEEN 6 AND 254
                  AND v_term ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$';
    IF v_is_email THEN
        SELECT u.id INTO v_email_id
        FROM auth.users u
        JOIN public.profiles ep ON ep.id = u.id AND ep.discoverable_by_email
        WHERE u.email = v_term
        LIMIT 1;
    END IF;

    v_term := left(v_term, 50);
    v_like := replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_');

    RETURN QUERY
    SELECT
        p.id,
        public.profile_display_name(p.nickname, p.first_name, p.last_name),
        p.nickname,
        p.first_name,
        p.last_name,
        p.is_bot,
        p.require_follow_approval,
        t.name,
        rs.last_public_activity_date,
        COALESCE(rs.public_ride_count, 0),
        public.follow_status(v_me, p.id)
    FROM public.profiles p
    LEFT JOIN public.rider_stats rs ON rs.user_id = p.id
    LEFT JOIN public.tracks t ON t.id = p.home_track_id
    WHERE p.id <> v_me
      AND (NOT p_bots_only OR p.is_bot)
      AND (
            CASE
                WHEN v_is_email THEN p.id = v_email_id
                WHEN v_term = '' THEN TRUE
                ELSE public.rider_search_text(p.first_name, p.last_name, p.nickname) LIKE '%' || v_like || '%' ESCAPE '\'
            END
          )
      AND NOT public.is_blocked_between(v_me, p.id)
    ORDER BY
        CASE
            WHEN v_term = '' OR v_is_email THEN 0
            WHEN lower(COALESCE(p.nickname, '')) LIKE v_like || '%' ESCAPE '\' THEN 0
            WHEN public.rider_search_text(p.first_name, p.last_name, p.nickname) LIKE v_like || '%' ESCAPE '\' THEN 0
            WHEN public.rider_search_text(p.first_name, p.last_name, p.nickname) LIKE '% ' || v_like || '%' ESCAPE '\' THEN 1
            ELSE 2
        END,
        rs.last_public_activity_date DESC NULLS LAST,
        p.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

CREATE FUNCTION public.get_rider_profile(p_id UUID)
RETURNS TABLE (
    id UUID,
    display_name TEXT,
    nickname TEXT,
    first_name TEXT,
    last_name TEXT,
    is_bot BOOLEAN,
    require_follow_approval BOOLEAN,
    home_track_name TEXT,
    last_activity_date DATE,
    ride_count INTEGER,
    follower_count INTEGER,
    following_count INTEGER,
    follow_status TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
BEGIN
    IF v_me IS NULL OR public.is_blocked_between(v_me, p_id) THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT
        p.id,
        public.profile_display_name(p.nickname, p.first_name, p.last_name),
        p.nickname,
        p.first_name,
        p.last_name,
        p.is_bot,
        p.require_follow_approval,
        t.name,
        rs.last_public_activity_date,
        COALESCE(rs.public_ride_count, 0),
        (SELECT count(*)::int FROM public.follows f WHERE f.followee_id = p.id),
        (SELECT count(*)::int FROM public.follows f WHERE f.follower_id = p.id),
        CASE WHEN p.id = v_me THEN 'self' ELSE public.follow_status(v_me, p.id) END
    FROM public.profiles p
    LEFT JOIN public.rider_stats rs ON rs.user_id = p.id
    LEFT JOIN public.tracks t ON t.id = p.home_track_id
    WHERE p.id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.search_riders(TEXT, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_rider_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_riders(TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rider_profile(UUID) TO authenticated;

-- 7. Private tables are not readable by anonymous clients at all -----------------------
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.profile_secrets FROM anon;
REVOKE ALL ON public.rider_stats FROM anon, authenticated;
