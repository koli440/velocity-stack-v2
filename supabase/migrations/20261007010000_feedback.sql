-- General feedback & feature requests, migrated from v1's Feedback page
-- (pages/70_feedback.py). Distinct from bug_reports: this covers feature
-- requests and general feedback, and exposes a shared community roadmap
-- (New / In-Progress / Done) visible to every signed-in user.
CREATE TABLE IF NOT EXISTS public.feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'general'
        CHECK (category IN ('bug', 'feature_request', 'general')),
    module TEXT NOT NULL DEFAULT 'other'
        CHECK (module IN ('aero_lab', 'pursuit_strategist', 'gear_architect', 'pb_vault', 'account_login', 'other')),
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'in_progress', 'done')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON public.feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON public.feedback(status);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- DROP POLICY IF EXISTS guards make this safe to re-run: this migration's version
-- number used to collide with 20261007000000_personal_bests.sql, so it may already
-- have been applied once under the old colliding timestamp.
DROP POLICY IF EXISTS "Users can submit feedback" ON public.feedback;
CREATE POLICY "Users can submit feedback"
    ON public.feedback FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- The community roadmap is shared: any signed-in user can see all entries
-- (the API layer only returns category/module/description/status, never
-- user_id, to keep authorship private).
DROP POLICY IF EXISTS "Signed-in users can view the feedback roadmap" ON public.feedback;
CREATE POLICY "Signed-in users can view the feedback roadmap"
    ON public.feedback FOR SELECT
    USING (auth.role() = 'authenticated');
