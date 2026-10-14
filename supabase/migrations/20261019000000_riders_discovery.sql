-- Rider discovery (issue #80 follow-up): scalable, paginated, searchable rider list and
-- rider profile RPCs. No secrets or manual steps; deployed by the Supabase integration.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- 1. Public activity stats per rider ----------------------------------------------------
-- Maintained by a trigger so the list can be ordered by "recently active" with an index
-- instead of aggregating the activities table per request. Only visibility = 'public'
-- activities count, so nothing followers-only/private leaks to non-followers.
CREATE TABLE IF NOT EXISTS public.rider_stats (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_public_activity_date DATE,
    public_ride_count INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE public.rider_stats ENABLE ROW LEVEL SECURITY;  -- no policies: read via RPCs only

CREATE INDEX IF NOT EXISTS idx_rider_stats_recent
    ON public.rider_stats (last_public_activity_date DESC NULLS LAST, user_id);

CREATE OR REPLACE FUNCTION public.refresh_rider_stats(p_user UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.rider_stats AS rs (user_id, last_public_activity_date, public_ride_count)
    SELECT p_user, max(a.activity_date)::date, count(*)
    FROM public.activities a
    WHERE a.user_id = p_user AND a.visibility = 'public'
    ON CONFLICT (user_id) DO UPDATE
        SET last_public_activity_date = EXCLUDED.last_public_activity_date,
            public_ride_count = EXCLUDED.public_ride_count
    WHERE EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_rider_stats()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.visibility = 'public' THEN
            INSERT INTO public.rider_stats AS rs (user_id, last_public_activity_date, public_ride_count)
            SELECT NEW.user_id, NEW.activity_date::date, 1
            WHERE EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id)
            ON CONFLICT (user_id) DO UPDATE
                SET last_public_activity_date = GREATEST(rs.last_public_activity_date, EXCLUDED.last_public_activity_date),
                    public_ride_count = rs.public_ride_count + 1;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.visibility = 'public' THEN PERFORM public.refresh_rider_stats(OLD.user_id); END IF;
    ELSE
        IF OLD.visibility = 'public' OR NEW.visibility = 'public' THEN
            PERFORM public.refresh_rider_stats(NEW.user_id);
            IF OLD.user_id <> NEW.user_id THEN PERFORM public.refresh_rider_stats(OLD.user_id); END IF;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rider_stats_ins_del ON public.activities;
CREATE TRIGGER trg_rider_stats_ins_del
    AFTER INSERT OR DELETE ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.trg_rider_stats();

DROP TRIGGER IF EXISTS trg_rider_stats_upd ON public.activities;
CREATE TRIGGER trg_rider_stats_upd
    AFTER UPDATE OF visibility, activity_date, user_id ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.trg_rider_stats();

-- Backfill
INSERT INTO public.rider_stats (user_id, last_public_activity_date, public_ride_count)
SELECT a.user_id, max(a.activity_date)::date, count(*)
FROM public.activities a
JOIN public.profiles p ON p.id = a.user_id
WHERE a.visibility = 'public'
GROUP BY a.user_id
ON CONFLICT (user_id) DO UPDATE
    SET last_public_activity_date = EXCLUDED.last_public_activity_date,
        public_ride_count = EXCLUDED.public_ride_count;

-- 2. Search indexes ------------------------------------------------------------------------
-- IMMUTABLE so it can back an expression index. The RPC filters on exactly this expression.
CREATE OR REPLACE FUNCTION public.rider_search_text(p_first TEXT, p_last TEXT, p_nick TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT lower(COALESCE(p_first, '') || ' ' || COALESCE(p_last, '') || ' ' || COALESCE(p_nick, ''))
$$;

CREATE INDEX IF NOT EXISTS idx_follows_followee ON public.follows (followee_id);
CREATE INDEX IF NOT EXISTS idx_follow_requests_requester ON public.follow_requests (requester_id);
CREATE INDEX IF NOT EXISTS idx_profiles_is_bot ON public.profiles (id) WHERE is_bot;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_opclass WHERE opcname = 'gin_trgm_ops') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_search_trgm ON public.profiles
                 USING gin (public.rider_search_text(first_name, last_name, nickname) gin_trgm_ops)';
    END IF;
END $$;

-- 3. Shared lookup of the viewer's relationship to a rider ------------------------------
CREATE OR REPLACE FUNCTION public.follow_status(p_viewer UUID, p_target UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM public.follows WHERE follower_id = p_viewer AND followee_id = p_target) THEN 'following'
        WHEN EXISTS (SELECT 1 FROM public.follow_requests WHERE requester_id = p_viewer AND target_id = p_target) THEN 'requested'
        ELSE 'none'
    END
$$;

-- 4. search_riders ---------------------------------------------------------------------------
-- Default order: recently active (public rides) first, then riders without public rides.
-- With a term: name-prefix matches rank first, then recency. Offset pagination (stable
-- because of the id tiebreaker). Excludes the caller and anyone blocked in either direction.
CREATE OR REPLACE FUNCTION public.search_riders(
    p_term TEXT DEFAULT '',
    p_bots_only BOOLEAN DEFAULT FALSE,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    username TEXT,
    full_name TEXT,
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
    v_like TEXT;
BEGIN
    IF v_me IS NULL THEN
        RETURN;
    END IF;
    v_term := left(v_term, 50);
    v_like := replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_');

    RETURN QUERY
    SELECT
        p.id,
        COALESCE(NULLIF(p.nickname, ''), NULLIF(p.first_name, '')),
        NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
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
      AND (v_term = '' OR public.rider_search_text(p.first_name, p.last_name, p.nickname)
                          LIKE '%' || v_like || '%' ESCAPE '\')
      AND NOT public.is_blocked_between(v_me, p.id)
    ORDER BY
        CASE
            WHEN v_term = '' THEN 0
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

-- 5. get_rider_profile ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_rider_profile(p_id UUID)
RETURNS TABLE (
    id UUID,
    username TEXT,
    full_name TEXT,
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
        COALESCE(NULLIF(p.nickname, ''), NULLIF(p.first_name, '')),
        NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
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
REVOKE ALL ON FUNCTION public.follow_status(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_rider_stats(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_riders(TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rider_profile(UUID) TO authenticated;
