-- VelocityStack: Analysis template menu (issue #44)
-- Per-user favorites for analysis templates, plus RLS tightening so only a
-- user's own *private* templates can be deleted.

CREATE TABLE IF NOT EXISTS public.template_favorites (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES public.analysis_templates(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_template_favorites_template ON public.template_favorites(template_id);

ALTER TABLE public.template_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "template_favorites_select_own" ON public.template_favorites;
CREATE POLICY "template_favorites_select_own"
ON public.template_favorites FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Only templates the caller can see (system, own, or public) can be favorited.
DROP POLICY IF EXISTS "template_favorites_insert_own" ON public.template_favorites;
CREATE POLICY "template_favorites_insert_own"
ON public.template_favorites FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.analysis_templates t
        WHERE t.id = template_id
          AND (t.user_id IS NULL OR t.user_id = auth.uid() OR t.visibility = 'public')
    )
);

DROP POLICY IF EXISTS "template_favorites_delete_own" ON public.template_favorites;
CREATE POLICY "template_favorites_delete_own"
ON public.template_favorites FOR DELETE
TO authenticated
USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.template_favorites TO authenticated;

-- Only own private templates may be deleted (public ones may have been run by others).
DROP POLICY IF EXISTS "Users delete own analysis templates" ON public.analysis_templates;
DROP POLICY IF EXISTS "Users delete own private analysis templates" ON public.analysis_templates;
CREATE POLICY "Users delete own private analysis templates"
ON public.analysis_templates FOR DELETE
TO authenticated
USING (user_id = auth.uid() AND visibility = 'private');

-- "Last updated" for the template cards.
ALTER TABLE public.analysis_templates
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION public.touch_analysis_template_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analysis_templates_updated_at ON public.analysis_templates;
CREATE TRIGGER trg_analysis_templates_updated_at
    BEFORE UPDATE ON public.analysis_templates
    FOR EACH ROW EXECUTE FUNCTION public.touch_analysis_template_updated_at();
