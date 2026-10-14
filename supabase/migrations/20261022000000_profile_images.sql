-- Profile images (issue #30).
--   * public.profiles.avatar_url: public URL of the rider's image in the `avatars` bucket
--     (bots point at bundled /avatars/bots/<persona>.png assets instead).
--   * public `avatars` storage bucket: 2 MB, JPEG/PNG/WebP; riders manage only objects
--     under their own <user_id>/ prefix.
--   * avatar_url is exposed through public_profiles, search_riders and get_rider_profile.
-- Idempotent; no secrets or manual steps.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Riders can write their own profile row, so only URLs pointing at their own folder of the
-- avatars bucket are accepted (no arbitrary external/tracking images). Bots may use bundled assets.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_avatar_url_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_url_check CHECK (
    avatar_url IS NULL
    OR avatar_url ~ ('^https://[^/]+/storage/v1/object/public/avatars/' || id::text || '/[^/?#]+(\?v=[0-9]+)?$')
    OR (is_bot AND avatar_url ~ '^/avatars/bots/[a-z0-9_-]+\.png$')
);

-- Bucket ---------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', TRUE, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
    SET public = TRUE,
        file_size_limit = 2097152,
        allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Public bucket: objects are readable by URL without a policy. Policies below only let a
-- rider list/insert/replace/delete files under their own user_id/ prefix.
DROP POLICY IF EXISTS "avatars_select_own" ON storage.objects;
CREATE POLICY "avatars_select_own" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
CREATE POLICY "avatars_insert_own" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
CREATE POLICY "avatars_update_own" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])
    WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
CREATE POLICY "avatars_delete_own" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- public_profiles ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles AS
    SELECT
        p.id,
        public.profile_display_name(p.nickname, p.first_name, p.last_name) AS display_name,
        p.nickname,
        p.first_name,
        p.last_name,
        p.require_follow_approval,
        p.is_bot,
        p.avatar_url
    FROM public.profiles p
    WHERE NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE b.blocker_id = p.id AND b.blocked_id = auth.uid()
    );
REVOKE ALL ON public.public_profiles FROM PUBLIC, anon;
GRANT SELECT ON public.public_profiles TO authenticated;

-- Rider discovery RPCs (return type changes, so drop first) -----------------------------
DROP FUNCTION IF EXISTS public.search_riders(TEXT, BOOLEAN, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.get_rider_profile(UUID);

CREATE OR REPLACE FUNCTION public.search_riders(
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
    avatar_url TEXT,
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
        p.avatar_url,
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

CREATE OR REPLACE FUNCTION public.get_rider_profile(p_id UUID)
RETURNS TABLE (
    id UUID,
    display_name TEXT,
    nickname TEXT,
    first_name TEXT,
    last_name TEXT,
    avatar_url TEXT,
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
        p.avatar_url,
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

-- Bot personas get generated avatars (bundled assets, see docs/bots.md) -------------------
UPDATE public.profiles
SET avatar_url = '/avatars/bots/' || bot_persona || '.png'
WHERE is_bot AND bot_persona ~ '^[a-z0-9_-]+$' AND avatar_url IS NULL;
