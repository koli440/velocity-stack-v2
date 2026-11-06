-- Public blog pages are rendered without a signed-in user, so they cannot read profiles.
-- Expose only the (already public: avatars bucket) image URL of one rider by exact nickname.
CREATE OR REPLACE FUNCTION public.blog_author_avatar(p_nickname TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.avatar_url
    FROM public.profiles p
    WHERE lower(p.nickname) = lower(btrim(p_nickname))
      AND p.avatar_url IS NOT NULL
    ORDER BY p.created_at NULLS LAST
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.blog_author_avatar(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.blog_author_avatar(TEXT) TO anon, authenticated;
