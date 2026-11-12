-- Season recap: include the rider's profile picture URL in the public shared payload.
-- Only a live opt-in share row exposes it (the same gate as the rest of the payload); revoking the link removes it.
-- avatar_url is the URL of an object in the already-public `avatars` bucket; NULL when the rider has none.
CREATE OR REPLACE FUNCTION public.get_shared_season_recap(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'year', s.season_year,
        'name', COALESCE(NULLIF(BTRIM(p.nickname), ''), NULLIF(BTRIM(p.first_name), ''), 'A rider'),
        'avatar_url', NULLIF(BTRIM(p.avatar_url), ''),
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
