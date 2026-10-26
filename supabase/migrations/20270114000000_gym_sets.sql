-- Gym session detail (issue #326, layer 2): exercises and sets from .fit strength files, plus a one-time
-- re-open of the history backfill so sessions synced before layer 1 are picked up.
--
--  * gym_exercises: one row per exercise block of a gym session (consecutive sets of the same exercise).
--  * gym_sets: one row per set, in order. set_type 'active' carries reps / weight_kg / duration_s, 'rest' the rest
--    time that followed. `metrics` (jsonb, default '{}') is reserved for per-set extras so per-rep data (bar
--    velocity, #327) can be added later without touching this table's columns.
--  * Sources without set data (Strava / Intervals.icu summaries) simply have no rows here.
--  * RLS: owner full access (through the parent activity); read for everyone who can see the activity (followers /
--    public per visibility, active coach), the same rule as comments. user_id is denormalised for analytics.
--  * activities.gym_detail_checked_at: set once the sets of a file-backed gym session were looked for, so the
--    bounded repair does not retry it forever.
--  * Additive and idempotent. Rides are not touched.

ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS gym_detail_checked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.gym_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    category TEXT CHECK (category IS NULL OR char_length(category) <= 80),
    subtype TEXT CHECK (subtype IS NULL OR char_length(subtype) <= 80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (activity_id, position)
);

CREATE TABLE IF NOT EXISTS public.gym_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
    exercise_id UUID NOT NULL REFERENCES public.gym_exercises(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    set_type TEXT NOT NULL DEFAULT 'active' CHECK (set_type IN ('active', 'rest')),
    start_time TIMESTAMPTZ,
    duration_s NUMERIC CHECK (duration_s IS NULL OR (duration_s >= 0 AND duration_s < 86400)),
    reps INTEGER CHECK (reps IS NULL OR (reps >= 0 AND reps < 10000)),
    weight_kg NUMERIC CHECK (weight_kg IS NULL OR (weight_kg >= 0 AND weight_kg < 4000)),
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (activity_id, position)
);

CREATE INDEX IF NOT EXISTS idx_gym_exercises_user_name ON public.gym_exercises (user_id, name);
CREATE INDEX IF NOT EXISTS idx_gym_sets_exercise ON public.gym_sets (exercise_id, position);

-- Wrapper so policies can use the (revoked) visibility helper; same rule as the comment stream.
CREATE OR REPLACE FUNCTION public.can_view_gym_detail(p_activity UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT public.user_can_view_activity(auth.uid(), p_activity)
$$;
REVOKE ALL ON FUNCTION public.can_view_gym_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_gym_detail(UUID) TO authenticated;

ALTER TABLE public.gym_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_sets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gym_exercises, public.gym_sets FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gym_exercises, public.gym_sets TO authenticated;

DROP POLICY IF EXISTS "gym_exercises_select" ON public.gym_exercises;
CREATE POLICY "gym_exercises_select" ON public.gym_exercises FOR SELECT TO authenticated
    USING (public.can_view_gym_detail(activity_id));
DROP POLICY IF EXISTS "gym_exercises_insert_own" ON public.gym_exercises;
CREATE POLICY "gym_exercises_insert_own" ON public.gym_exercises FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_id AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS "gym_exercises_update_own" ON public.gym_exercises;
CREATE POLICY "gym_exercises_update_own" ON public.gym_exercises FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_id AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS "gym_exercises_delete_own" ON public.gym_exercises;
CREATE POLICY "gym_exercises_delete_own" ON public.gym_exercises FOR DELETE TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "gym_sets_select" ON public.gym_sets;
CREATE POLICY "gym_sets_select" ON public.gym_sets FOR SELECT TO authenticated
    USING (public.can_view_gym_detail(activity_id));
DROP POLICY IF EXISTS "gym_sets_insert_own" ON public.gym_sets;
CREATE POLICY "gym_sets_insert_own" ON public.gym_sets FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.gym_exercises e
                    WHERE e.id = exercise_id AND e.activity_id = gym_sets.activity_id AND e.user_id = auth.uid()));
DROP POLICY IF EXISTS "gym_sets_update_own" ON public.gym_sets;
CREATE POLICY "gym_sets_update_own" ON public.gym_sets FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.gym_exercises e
                    WHERE e.id = exercise_id AND e.activity_id = gym_sets.activity_id AND e.user_id = auth.uid()));
DROP POLICY IF EXISTS "gym_sets_delete_own" ON public.gym_sets;
CREATE POLICY "gym_sets_delete_own" ON public.gym_sets FOR DELETE TO authenticated
    USING (user_id = auth.uid());

-- One-time re-open of the history backfill: before layer 1 every source imported rides only, so finished
-- backfills never listed gym sessions. Rides already imported are skipped by external id, so only the missing
-- gym sessions are fetched; the normal backfill quotas and the Strava request budget bound the work.
UPDATE public.connections
SET backfill_complete = FALSE,
    backfill_cursor = NULL,
    backfill_imported = 0,
    backfill_total = NULL,
    last_attempt_at = NULL,
    updated_at = NOW()
WHERE provider IN ('strava', 'intervals', 'wahoo')
  AND status <> 'disconnected'
  AND backfill_complete = TRUE;
