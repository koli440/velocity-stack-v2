-- Template runs (issue #283): the reference a rider (or a coach, in athlete context) compares a template's
-- runs against is remembered per user + template. Additive and idempotent.
--
--  * user_id  = whoever chose the reference (always the caller).
--  * scope_id = whose runs are compared: the caller himself, or an athlete the caller actively coaches.
--  * custom_execution_id is a plain UUID (no foreign key): a deleted or unreadable run simply falls back
--    to "previous run" in the UI, and the preference can never reveal or pin another account's data.

CREATE TABLE IF NOT EXISTS public.template_reference_prefs (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    scope_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    template_slug TEXT NOT NULL CHECK (char_length(template_slug) BETWEEN 1 AND 200),
    mode TEXT NOT NULL CHECK (mode IN ('previous', 'pb', 'median5', 'custom')),
    custom_execution_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, scope_id, template_slug),
    CHECK (mode = 'custom' OR custom_execution_id IS NULL)
);

ALTER TABLE public.template_reference_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.template_reference_prefs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_reference_prefs TO authenticated;

DROP POLICY IF EXISTS "template_reference_prefs_select_own" ON public.template_reference_prefs;
DROP POLICY IF EXISTS "template_reference_prefs_insert_own" ON public.template_reference_prefs;
DROP POLICY IF EXISTS "template_reference_prefs_update_own" ON public.template_reference_prefs;
DROP POLICY IF EXISTS "template_reference_prefs_delete_own" ON public.template_reference_prefs;

CREATE POLICY "template_reference_prefs_select_own" ON public.template_reference_prefs FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- Own scope, or an athlete the caller actively coaches right now.
CREATE POLICY "template_reference_prefs_insert_own" ON public.template_reference_prefs FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() AND (scope_id = auth.uid() OR public.is_coach_of(scope_id)));

CREATE POLICY "template_reference_prefs_update_own" ON public.template_reference_prefs FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid() AND (scope_id = auth.uid() OR public.is_coach_of(scope_id)));

CREATE POLICY "template_reference_prefs_delete_own" ON public.template_reference_prefs FOR DELETE TO authenticated
    USING (user_id = auth.uid());
