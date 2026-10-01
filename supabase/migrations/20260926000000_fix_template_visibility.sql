-- Fix visibility of analysis_templates / template_executions for the anon &
-- authenticated roles used by the app's Supabase client. Without explicit
-- grants + RLS policies, PostgREST returns an empty result set for these new
-- tables instead of an error, which is why the template dropdown appeared
-- empty even though rows existed in the database.

-- 1. Explicit privilege grants (belt-and-braces in case default privileges
--    weren't inherited when these tables were created).
GRANT SELECT ON public.analysis_templates TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_executions TO authenticated;

-- 2. analysis_templates: reference data, publicly readable, not writable
--    from the client (seeded via migrations only).
ALTER TABLE public.analysis_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access to analysis templates" ON public.analysis_templates;
CREATE POLICY "Public read access to analysis templates"
ON public.analysis_templates FOR SELECT
TO anon, authenticated
USING (true);

-- 3. template_executions: each user can only see/manage their own executions.
ALTER TABLE public.template_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own template executions" ON public.template_executions;
CREATE POLICY "Users manage own template executions"
ON public.template_executions FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
