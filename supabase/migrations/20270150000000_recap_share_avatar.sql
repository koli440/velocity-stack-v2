-- Season recap: include the rider's profile picture URL in the public shared payload.
-- Only a live opt-in share row exposes it (the same gate as the rest of the payload); revoking the link removes it.
-- avatar_url is only exposed when it points at the public `avatars` storage bucket (the column is client-writable);
-- otherwise NULL. The host is checked against the Supabase origin in JS (safeAvatarUrl).
CREATE OR REPLACE FUNCTION public.get_shared_season_recap(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'year', s.season_year,
        'name', COALESCE(NULLIF(BTRIM(p.nickname), ''), NULLIF(BTRIM(p.first_name), ''), 'A rider'),
        'avatar_url', CASE WHEN BTRIM(p.avatar_url) ~ '^https://[^/?#@]+/storage/v1/object/public/avatars/' THEN BTRIM(p.avatar_url) END,
        'recap', public.season_recap_compute(s.user_id, s.season_year, TRUE) #- '{longest_ride,id}' #- '{longest_ride,title}'
    )
    FROM public.season_recap_shares s
    JOIN public.profiles p ON p.id = s.user_id
    WHERE s.slug = p_slug
      AND p_slug ~ '^[0-9a-f]{20}$'
$$;
REVOKE ALL ON FUNCTION public.get_shared_season_recap(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_season_recap(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
