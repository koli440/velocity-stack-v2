-- Coaching: a coach runs templates on the activities of an athlete he actively coaches.
--
--  * The run row lives on the RIDER's account (template_executions.user_id = rider) and is stamped
--    by the database (by_coach, run_by_coach_id) - clients can neither set nor change the stamp.
--  * Allowed templates: the coach's OWN templates and system templates. Never the rider's.
--  * The rider sees results + the template NAME. The run row stores a snapshot of name/slug/
--    category only; the coach template's manifest / dsl_source stay unreadable for the rider
--    (analysis_templates RLS is unchanged: own + system + public).
--  * Coach may delete / re-run only his own runs while is_coach_of(); the rider may delete any run.
--  * Runs survive the end of the relationship (and deletion of the template or the coach account).
--  * No notification. Never sendable to the PB Vault (the vault has no link to executions; the UI
--    hides the button for coach runs).
-- Coach runs live on the rider's account, so the coach's own stats/history (user_id = coach) never
-- include them. All new objects are idempotent.

-- 1. Columns -------------------------------------------------------------------------------
ALTER TABLE public.template_executions
    ADD COLUMN IF NOT EXISTS by_coach BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS run_by_coach_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    -- Uniqueness key: the coach id of a coach run (kept even if the coach account is deleted),
    -- all zeros for the rider's own runs. A rider run and a coach run of the same template on the
    -- same activity can therefore coexist.
    ADD COLUMN IF NOT EXISTS coach_key UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    ADD COLUMN IF NOT EXISTS template_name TEXT,
    ADD COLUMN IF NOT EXISTS template_slug TEXT,
    ADD COLUMN IF NOT EXISTS template_category TEXT;

-- A deleted template must not delete coach runs from the rider's account: template_id becomes NULL
-- (the trigger below keeps the old cascade for every other run).
ALTER TABLE public.template_executions ALTER COLUMN template_id DROP NOT NULL;
ALTER TABLE public.template_executions DROP CONSTRAINT IF EXISTS template_executions_template_id_fkey;
ALTER TABLE public.template_executions
    ADD CONSTRAINT template_executions_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES public.analysis_templates(id) ON DELETE SET NULL;

ALTER TABLE public.template_executions DROP CONSTRAINT IF EXISTS template_executions_activity_template_unique;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'template_executions_activity_template_coach_unique'
          AND conrelid = 'public.template_executions'::regclass
    ) THEN
        ALTER TABLE public.template_executions
            ADD CONSTRAINT template_executions_activity_template_coach_unique
            UNIQUE (activity_id, template_id, coach_key);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_template_executions_coach_runs
    ON public.template_executions(user_id) WHERE by_coach;

-- Backfill name snapshots of existing runs.
UPDATE public.template_executions e
   SET template_name = t.name, template_slug = t.slug, template_category = t.category
  FROM public.analysis_templates t
 WHERE t.id = e.template_id AND e.template_name IS NULL;

-- 2. Triggers ------------------------------------------------------------------------------
-- Fills the name snapshot on insert (SECURITY DEFINER: the rider cannot read a private coach template,
-- but may see its name on the run). Only name/slug/category are copied, never the definition.
CREATE OR REPLACE FUNCTION public.template_executions_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.template_id IS NOT NULL AND (NEW.template_name IS NULL OR NEW.template_slug IS NULL) THEN
        SELECT t.name, t.slug, t.category INTO NEW.template_name, NEW.template_slug, NEW.template_category
          FROM public.analysis_templates t WHERE t.id = NEW.template_id;
    END IF;
    IF NEW.by_coach THEN
        NEW.coach_key := COALESCE(NEW.run_by_coach_id, NEW.coach_key);
    ELSE
        NEW.coach_key := '00000000-0000-0000-0000-000000000000';
        NEW.run_by_coach_id := NULL;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_template_executions_snapshot ON public.template_executions;
CREATE TRIGGER trg_template_executions_snapshot
    BEFORE INSERT ON public.template_executions
    FOR EACH ROW EXECUTE FUNCTION public.template_executions_snapshot();

-- The coach stamp is immutable (run_by_coach_id may only be nulled by the FK when the coach account goes).
CREATE OR REPLACE FUNCTION public.template_executions_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.by_coach IS DISTINCT FROM OLD.by_coach
       OR NEW.coach_key IS DISTINCT FROM OLD.coach_key
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR (NEW.run_by_coach_id IS DISTINCT FROM OLD.run_by_coach_id AND NEW.run_by_coach_id IS NOT NULL) THEN
        RAISE EXCEPTION 'The coach stamp of a template run cannot be changed';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_template_executions_guard ON public.template_executions;
CREATE TRIGGER trg_template_executions_guard
    BEFORE UPDATE ON public.template_executions
    FOR EACH ROW EXECUTE FUNCTION public.template_executions_guard();

-- Keep the snapshot in sync when the template is renamed.
CREATE OR REPLACE FUNCTION public.analysis_templates_sync_run_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE public.template_executions
       SET template_name = NEW.name, template_slug = NEW.slug, template_category = NEW.category
     WHERE template_id = NEW.id;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_analysis_templates_sync_run_snapshot ON public.analysis_templates;
CREATE TRIGGER trg_analysis_templates_sync_run_snapshot
    AFTER UPDATE OF name, slug, category ON public.analysis_templates
    FOR EACH ROW EXECUTE FUNCTION public.analysis_templates_sync_run_snapshot();

-- Deleting a template keeps cascading to ordinary runs (as before) but never to coach runs.
CREATE OR REPLACE FUNCTION public.analysis_templates_keep_coach_runs()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    DELETE FROM public.template_executions WHERE template_id = OLD.id AND NOT by_coach;
    RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_analysis_templates_keep_coach_runs ON public.analysis_templates;
CREATE TRIGGER trg_analysis_templates_keep_coach_runs
    BEFORE DELETE ON public.analysis_templates
    FOR EACH ROW EXECUTE FUNCTION public.analysis_templates_keep_coach_runs();

-- 3. RLS: the rider manages only non-coach rows; may delete any run on his account ----------
DROP POLICY IF EXISTS "Users manage own template executions" ON public.template_executions;
DROP POLICY IF EXISTS "template_executions_select_own" ON public.template_executions;
DROP POLICY IF EXISTS "template_executions_insert_own" ON public.template_executions;
DROP POLICY IF EXISTS "template_executions_update_own" ON public.template_executions;
DROP POLICY IF EXISTS "template_executions_delete_own" ON public.template_executions;

CREATE POLICY "template_executions_select_own" ON public.template_executions FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- The rider can only create plain runs of templates he can see (so a coach-private template cannot be
-- used to read its name or to forge a coach stamp).
CREATE POLICY "template_executions_insert_own" ON public.template_executions FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND NOT by_coach AND run_by_coach_id IS NULL
        AND template_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.analysis_templates t WHERE t.id = template_id)
    );

CREATE POLICY "template_executions_update_own" ON public.template_executions FOR UPDATE TO authenticated
    USING (user_id = auth.uid() AND NOT by_coach)
    WITH CHECK (user_id = auth.uid() AND NOT by_coach AND run_by_coach_id IS NULL);

CREATE POLICY "template_executions_delete_own" ON public.template_executions FOR DELETE TO authenticated
    USING (user_id = auth.uid());

-- (template_executions_select_coach from the coaching migration stays: the coach reads the results.)

-- 4. Coach write path: SECURITY DEFINER functions only ------------------------------------
-- Inputs needed to evaluate a template on an athlete's activity. The base activities table stays
-- owner-only; this returns only the evaluation columns, with GPS removed from the streams.
CREATE OR REPLACE FUNCTION public.coach_template_run_inputs(p_activity UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    a public.activities%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;
    SELECT * INTO a FROM public.activities WHERE id = p_activity;
    IF NOT FOUND OR a.user_id = auth.uid() OR NOT public.is_coach_of(a.user_id) THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;
    RETURN jsonb_build_object(
        'id', a.id,
        'user_id', a.user_id,
        'time_series', CASE WHEN a.time_series IS NULL THEN NULL ELSE a.time_series - 'latitude' - 'longitude' END,
        'ftp_at_activity_w', a.ftp_at_activity_w,
        'max_hr', a.max_hr,
        'weight_at_activity_kg', a.weight_at_activity_kg,
        'power_zone_pcts_at_activity', to_jsonb(a) -> 'power_zone_pcts_at_activity',
        'lt1_power_at_activity_w', a.lt1_power_at_activity_w,
        'lt1_hr_at_activity', a.lt1_hr_at_activity,
        'lt2_power_at_activity_w', a.lt2_power_at_activity_w,
        'lt2_hr_at_activity', a.lt2_hr_at_activity
    );
END;
$$;

-- Stores (or replaces, = re-run) the coach's run of one of his own / a system template on an athlete's activity.
CREATE OR REPLACE FUNCTION public.coach_save_template_run(
    p_activity UUID, p_template UUID, p_efforts JSONB, p_summary JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_owner UUID;
    t public.analysis_templates%ROWTYPE;
    v_row public.template_executions%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not signed in';
    END IF;
    SELECT user_id INTO v_owner FROM public.activities WHERE id = p_activity;
    IF v_owner IS NULL OR v_owner = v_uid OR NOT public.is_coach_of(v_owner) THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;
    -- Own or system templates only; never the rider's (nor other people's public ones).
    SELECT * INTO t FROM public.analysis_templates
     WHERE id = p_template AND (user_id IS NULL OR user_id = v_uid);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Template not available';
    END IF;
    IF p_efforts IS NULL OR jsonb_typeof(p_efforts) <> 'array'
       OR p_summary IS NULL OR jsonb_typeof(p_summary) <> 'object'
       OR pg_column_size(p_efforts) + pg_column_size(p_summary) > 1000000 THEN
        RAISE EXCEPTION 'Invalid run result';
    END IF;

    INSERT INTO public.template_executions AS e
        (activity_id, template_id, user_id, efforts, summary, by_coach, run_by_coach_id, coach_key,
         template_name, template_slug, template_category, updated_at)
    VALUES
        (p_activity, t.id, v_owner, p_efforts, p_summary, TRUE, v_uid, v_uid,
         t.name, t.slug, t.category, NOW())
    ON CONFLICT (activity_id, template_id, coach_key) DO UPDATE
        SET efforts = EXCLUDED.efforts, summary = EXCLUDED.summary, updated_at = NOW(),
            template_name = EXCLUDED.template_name, template_slug = EXCLUDED.template_slug,
            template_category = EXCLUDED.template_category
    RETURNING * INTO v_row;

    -- Only results and the name leave this function, never the template definition.
    RETURN jsonb_build_object(
        'id', v_row.id, 'activity_id', v_row.activity_id, 'template_id', v_row.template_id,
        'user_id', v_row.user_id, 'efforts', v_row.efforts, 'summary', v_row.summary,
        'by_coach', v_row.by_coach, 'run_by_coach_id', v_row.run_by_coach_id,
        'template_name', v_row.template_name, 'template_slug', v_row.template_slug,
        'template_category', v_row.template_category,
        'created_at', v_row.created_at, 'updated_at', v_row.updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.coach_delete_template_run(p_execution UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_n INTEGER;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not signed in';
    END IF;
    DELETE FROM public.template_executions e
     WHERE e.id = p_execution
       AND e.by_coach AND e.run_by_coach_id = auth.uid()
       AND public.is_coach_of(e.user_id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'Run not found';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.coach_template_run_inputs(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coach_save_template_run(UUID, UUID, JSONB, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coach_delete_template_run(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_template_run_inputs(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coach_save_template_run(UUID, UUID, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coach_delete_template_run(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.template_executions_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analysis_templates_sync_run_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analysis_templates_keep_coach_runs() FROM PUBLIC, anon, authenticated;
