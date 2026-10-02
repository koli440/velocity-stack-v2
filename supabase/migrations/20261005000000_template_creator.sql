-- VelocityStack: Template Creator (issue #14)
--
-- Adds a 5th, user-authorable analysis template pattern ("custom_intervals",
-- parsed from a text DSL — see src/lib/intervalDsl.js) on top of the existing
-- 4 fixed track-cycling discipline patterns. Users can now author, edit and
-- (optionally) publish their own templates instead of only picking from the
-- system-seeded set.

-- 1. analysis_templates: track ownership + visibility + the raw DSL source so
--    the creator UI can re-open a template for editing without re-deriving it
--    from the compiled manifest.
ALTER TABLE public.analysis_templates
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
    ADD COLUMN IF NOT EXISTS dsl_source TEXT;

CREATE INDEX IF NOT EXISTS idx_analysis_templates_user ON public.analysis_templates(user_id);

-- 2. Rewrite RLS: system templates (user_id IS NULL, seeded via migrations)
--    stay implicitly public and read-only from the client. Authenticated users
--    can additionally see their own templates (any visibility) and other
--    users' public templates, and can insert/update/delete only their own.
DROP POLICY IF EXISTS "Public read access to analysis templates" ON public.analysis_templates;

CREATE POLICY "Read system, own and public analysis templates"
ON public.analysis_templates FOR SELECT
TO anon, authenticated
USING (user_id IS NULL OR user_id = auth.uid() OR visibility = 'public');

CREATE POLICY "Users create own analysis templates"
ON public.analysis_templates FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own analysis templates"
ON public.analysis_templates FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own analysis templates"
ON public.analysis_templates FOR DELETE
TO authenticated
USING (user_id = auth.uid());

GRANT INSERT, UPDATE, DELETE ON public.analysis_templates TO authenticated;

-- 3. activities: point-in-time FTP snapshot. %FTP-banded custom_intervals
--    templates must always evaluate against the FTP that was valid when the
--    ride happened, never the athlete's current (possibly very different)
--    FTP. src/lib/activityRecord.js's buildActivityInsert already receives
--    this value transiently (meta.ftpWatts) to compute intensity_factor /
--    training_load — it is now also persisted as a raw column.
ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS ftp_at_activity_w INTEGER;
