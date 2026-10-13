-- VelocityStack: social activity feed (issue #49)
--
-- * follows: asymmetric follow graph (follower -> followee)
-- * activities.visibility: private | followers | public (existing rows stay private,
--   new rows default to followers)
-- * activities.route_preview / badges: persisted feed data so the feed never has to
--   load time_series and so badges of other riders can be shown
-- * public_profiles view: safe subset of profiles (no weight/FTP) readable by any
--   authenticated user, used for author headers and rider search
-- * RLS for activities and profiles (own rows + shared activities)

-- 1. Follow graph
CREATE TABLE IF NOT EXISTS public.follows (
    follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    followee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_followee ON public.follows(followee_id);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "follows_select_involved" ON public.follows;
CREATE POLICY "follows_select_involved"
    ON public.follows FOR SELECT
    USING (auth.uid() = follower_id OR auth.uid() = followee_id);

DROP POLICY IF EXISTS "follows_insert_own" ON public.follows;
CREATE POLICY "follows_insert_own"
    ON public.follows FOR INSERT
    WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "follows_delete_own" ON public.follows;
CREATE POLICY "follows_delete_own"
    ON public.follows FOR DELETE
    USING (auth.uid() = follower_id);

GRANT SELECT, INSERT, DELETE ON public.follows TO authenticated;

-- 2. Activity feed columns
ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
        CHECK (visibility IN ('private', 'followers', 'public')),
    -- {"kind":"route","points":[[x,y],...]} or {"kind":"sparkline","values":[...]}
    ADD COLUMN IF NOT EXISTS route_preview JSONB,
    -- NULL = not computed yet; [] = computed, no badges
    ADD COLUMN IF NOT EXISTS badges JSONB;

-- Existing rows stay private; new rows are shared with followers by default.
ALTER TABLE public.activities ALTER COLUMN visibility SET DEFAULT 'followers';

CREATE INDEX IF NOT EXISTS idx_activities_user_date
    ON public.activities(user_id, activity_date DESC, id DESC);

-- 3. RLS: activities
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activities_select_own" ON public.activities;
CREATE POLICY "activities_select_own"
    ON public.activities FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "activities_select_shared" ON public.activities;
CREATE POLICY "activities_select_shared"
    ON public.activities FOR SELECT
    TO authenticated
    USING (
        visibility = 'public'
        OR (
            visibility = 'followers'
            AND EXISTS (
                SELECT 1 FROM public.follows f
                WHERE f.follower_id = auth.uid() AND f.followee_id = activities.user_id
            )
        )
    );

DROP POLICY IF EXISTS "activities_insert_own" ON public.activities;
CREATE POLICY "activities_insert_own"
    ON public.activities FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "activities_update_own" ON public.activities;
CREATE POLICY "activities_update_own"
    ON public.activities FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "activities_delete_own" ON public.activities;
CREATE POLICY "activities_delete_own"
    ON public.activities FOR DELETE
    USING (auth.uid() = user_id);

-- 4. RLS: profiles (own row only; others are exposed through public_profiles)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Runs with the view owner's rights (bypasses profiles RLS) but only exposes
-- non-sensitive columns.
CREATE OR REPLACE VIEW public.public_profiles AS
    SELECT id, username, full_name, avatar_url
    FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated;
