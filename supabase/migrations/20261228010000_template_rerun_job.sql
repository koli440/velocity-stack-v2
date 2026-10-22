-- Issue #283: re-run every existing template run with the current detection so old runs gain the per-effort
-- fields (rep numbers, % of best, fade analysis). Detection is JS, so the work is done by the app route
-- /api/admin/template-rerun/run in small batches; this migration holds the state, the backups and the guarded
-- functions. Additive and idempotent. Nothing here changes a run until an admin starts the job
-- (/admin/template-reruns) or pg_cron finds the job in the "running" state.
--
-- Safety properties (enforced in template_rerun_apply):
--   * one transaction per run: backup + update + verification, or nothing;
--   * the previous efforts/summary are kept in template_execution_backups (never overwritten) until restored;
--   * only efforts and summary change: id, activity link, owner, created_at, updated_at, by_coach,
--     run_by_coach_id, coach_key and the name/slug/category snapshot are verified identical afterwards;
--   * a run that already has a backup is never processed twice (idempotent, no duplicates: no row is inserted);
--   * a run edited by its owner while the job was computing it is left alone (optimistic updated_at check);
--   * PB Vault entries are never read or written.
-- All objects are service-only (RLS on, no grants to anon/authenticated): reached via the admin-only API route.

CREATE TABLE IF NOT EXISTS public.template_execution_backups (
    execution_id UUID PRIMARY KEY,
    efforts JSONB NOT NULL,
    summary JSONB NOT NULL,
    original_updated_at TIMESTAMPTZ NOT NULL,
    backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    restored_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.template_rerun_items (
    execution_id UUID NOT NULL,
    dry_run BOOLEAN NOT NULL DEFAULT FALSE,
    activity_id UUID,
    user_id UUID,
    template_slug TEXT,
    by_coach BOOLEAN,
    status TEXT NOT NULL CHECK (status IN ('done', 'skipped', 'failed', 'restored')),
    reason TEXT,
    warning TEXT,
    attempts INT NOT NULL DEFAULT 1,
    had_rep_analysis_before BOOLEAN,
    efforts_before INT,
    efforts_after INT,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (execution_id, dry_run)
);
CREATE INDEX IF NOT EXISTS idx_template_rerun_items_status ON public.template_rerun_items (dry_run, status);

CREATE TABLE IF NOT EXISTS public.template_rerun_control (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'running', 'paused')),
    mode TEXT NOT NULL DEFAULT 'apply' CHECK (mode IN ('apply', 'dry_run')),
    cursor UUID,
    lease_until TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    started_by UUID,
    baseline_total INT,
    baseline_without_per_effort INT,
    baseline_taken_at TIMESTAMPTZ
);

ALTER TABLE public.template_execution_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_rerun_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_rerun_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.template_execution_backups, public.template_rerun_items, public.template_rerun_control FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.template_execution_backups, public.template_rerun_items, public.template_rerun_control TO service_role;

-- How many runs lack per-effort data when this migration is applied (every run: the fields are new).
INSERT INTO public.template_rerun_control (id, baseline_total, baseline_without_per_effort, baseline_taken_at)
SELECT TRUE, COUNT(*), COUNT(*) FILTER (WHERE NOT (summary ? 'rep_analysis')), NOW()
  FROM public.template_executions
ON CONFLICT (id) DO NOTHING;

-- Runs not yet processed after `p_after` (ids are walked in order); anything with a result row (done, skipped,
-- failed) or a backup is left out, so restarting after a pause or a crash resumes where it stopped.
CREATE OR REPLACE FUNCTION public.template_rerun_batch(p_after UUID, p_limit INT, p_dry BOOLEAN)
RETURNS TABLE (execution_id UUID, activity_id UUID, template_id UUID, user_id UUID, by_coach BOOLEAN,
               template_slug TEXT, updated_at TIMESTAMPTZ, efforts JSONB, summary JSONB, attempts INT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT te.id, te.activity_id, te.template_id, te.user_id, te.by_coach, te.template_slug, te.updated_at,
           te.efforts, te.summary, COALESCE(i.attempts, 0)
      FROM public.template_executions te
      LEFT JOIN public.template_rerun_items i ON i.execution_id = te.id AND i.dry_run = p_dry
     WHERE (p_after IS NULL OR te.id > p_after)
       AND i.execution_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.template_execution_backups b WHERE b.execution_id = te.id)
     ORDER BY te.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
$$;

-- Failed runs are retried by the next "start" (attempts < 3): they are handed out again here.
CREATE OR REPLACE FUNCTION public.template_rerun_retry_batch(p_after UUID, p_limit INT)
RETURNS TABLE (execution_id UUID, activity_id UUID, template_id UUID, user_id UUID, by_coach BOOLEAN,
               template_slug TEXT, updated_at TIMESTAMPTZ, efforts JSONB, summary JSONB, attempts INT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT te.id, te.activity_id, te.template_id, te.user_id, te.by_coach, te.template_slug, te.updated_at,
           te.efforts, te.summary, i.attempts
      FROM public.template_rerun_items i
      JOIN public.template_executions te ON te.id = i.execution_id
     WHERE i.dry_run = FALSE AND i.status = 'failed' AND i.attempts < 3
       AND (p_after IS NULL OR te.id > p_after)
       AND NOT EXISTS (SELECT 1 FROM public.template_execution_backups b WHERE b.execution_id = te.id)
     ORDER BY te.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
$$;

-- The guarded write. Returns 'done', 'already_done', 'changed' (the run was edited meanwhile) or 'missing'.
CREATE OR REPLACE FUNCTION public.template_rerun_apply(
    p_execution UUID, p_efforts JSONB, p_summary JSONB, p_expected_updated_at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_old public.template_executions%ROWTYPE;
    v_new public.template_executions%ROWTYPE;
    v_inserted INT;
BEGIN
    IF jsonb_typeof(p_efforts) IS DISTINCT FROM 'array' OR jsonb_typeof(p_summary) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'efforts must be an array and summary an object';
    END IF;

    SELECT * INTO v_old FROM public.template_executions WHERE id = p_execution FOR UPDATE;
    IF NOT FOUND THEN RETURN 'missing'; END IF;
    IF EXISTS (SELECT 1 FROM public.template_execution_backups WHERE execution_id = p_execution) THEN
        RETURN 'already_done';
    END IF;
    IF p_expected_updated_at IS NOT NULL AND v_old.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RETURN 'changed';
    END IF;

    INSERT INTO public.template_execution_backups (execution_id, efforts, summary, original_updated_at)
    VALUES (v_old.id, v_old.efforts, v_old.summary, v_old.updated_at)
    ON CONFLICT (execution_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN RETURN 'already_done'; END IF;

    UPDATE public.template_executions
       SET efforts = p_efforts, summary = p_summary, updated_at = v_old.updated_at
     WHERE id = p_execution;

    SELECT * INTO v_new FROM public.template_executions WHERE id = p_execution;
    IF v_new.id IS DISTINCT FROM v_old.id
       OR v_new.activity_id IS DISTINCT FROM v_old.activity_id
       OR v_new.template_id IS DISTINCT FROM v_old.template_id
       OR v_new.user_id IS DISTINCT FROM v_old.user_id
       OR v_new.created_at IS DISTINCT FROM v_old.created_at
       OR v_new.updated_at IS DISTINCT FROM v_old.updated_at
       OR v_new.by_coach IS DISTINCT FROM v_old.by_coach
       OR v_new.run_by_coach_id IS DISTINCT FROM v_old.run_by_coach_id
       OR v_new.coach_key IS DISTINCT FROM v_old.coach_key
       OR v_new.template_name IS DISTINCT FROM v_old.template_name
       OR v_new.template_slug IS DISTINCT FROM v_old.template_slug
       OR v_new.template_category IS DISTINCT FROM v_old.template_category
       OR v_new.efforts IS DISTINCT FROM p_efforts
       OR v_new.summary IS DISTINCT FROM p_summary THEN
        RAISE EXCEPTION 'verification failed for template run %, rolled back', p_execution;
    END IF;

    UPDATE public.template_execution_backups SET verified_at = NOW() WHERE execution_id = p_execution;
    RETURN 'done';
END;
$$;

-- Puts the backed-up efforts/summary back (stamps untouched). The backup row is kept.
CREATE OR REPLACE FUNCTION public.template_rerun_restore(p_execution UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_backup public.template_execution_backups%ROWTYPE;
BEGIN
    SELECT * INTO v_backup FROM public.template_execution_backups WHERE execution_id = p_execution FOR UPDATE;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    UPDATE public.template_executions
       SET efforts = v_backup.efforts, summary = v_backup.summary, updated_at = v_backup.original_updated_at
     WHERE id = p_execution;
    UPDATE public.template_execution_backups SET restored_at = NOW() WHERE execution_id = p_execution;
    INSERT INTO public.template_rerun_items (execution_id, dry_run, status, reason)
    VALUES (p_execution, FALSE, 'restored', 'restored from backup')
    ON CONFLICT (execution_id, dry_run) DO UPDATE SET status = 'restored', reason = 'restored from backup', processed_at = NOW();
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.template_rerun_counts()
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object(
        'total_runs', (SELECT COUNT(*) FROM public.template_executions),
        'without_per_effort', (SELECT COUNT(*) FROM public.template_executions WHERE NOT (summary ? 'rep_analysis')),
        'without_efforts', (SELECT COUNT(*) FROM public.template_executions WHERE jsonb_array_length(efforts) = 0),
        'backed_up', (SELECT COUNT(*) FROM public.template_execution_backups),
        'verified', (SELECT COUNT(*) FROM public.template_execution_backups WHERE verified_at IS NOT NULL),
        'done', (SELECT COUNT(*) FROM public.template_rerun_items WHERE NOT dry_run AND status = 'done'),
        'skipped', (SELECT COUNT(*) FROM public.template_rerun_items WHERE NOT dry_run AND status = 'skipped'),
        'failed', (SELECT COUNT(*) FROM public.template_rerun_items WHERE NOT dry_run AND status = 'failed'),
        'dry_would_rerun', (SELECT COUNT(*) FROM public.template_rerun_items WHERE dry_run AND status = 'done'),
        'dry_skipped', (SELECT COUNT(*) FROM public.template_rerun_items WHERE dry_run AND status = 'skipped'),
        'dry_failed', (SELECT COUNT(*) FROM public.template_rerun_items WHERE dry_run AND status = 'failed'),
        'control', (SELECT to_jsonb(c) FROM public.template_rerun_control c LIMIT 1)
    );
$$;

-- Control: start / pause / lease. A lease keeps two overlapping invocations (cron + chain) from working at once.
CREATE OR REPLACE FUNCTION public.template_rerun_start(p_mode TEXT, p_user UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v public.template_rerun_control%ROWTYPE;
BEGIN
    IF p_mode NOT IN ('apply', 'dry_run') THEN RAISE EXCEPTION 'unknown mode %', p_mode; END IF;
    INSERT INTO public.template_rerun_control (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
    SELECT * INTO v FROM public.template_rerun_control WHERE id FOR UPDATE;
    IF v.state = 'running' THEN RETURN FALSE; END IF;
    IF p_mode = 'dry_run' THEN
        DELETE FROM public.template_rerun_items WHERE dry_run;
    END IF;
    UPDATE public.template_rerun_control
       SET state = 'running', mode = p_mode, started_by = p_user, lease_until = NULL, finished_at = NULL,
           cursor = CASE WHEN v.state = 'paused' AND v.mode = p_mode THEN v.cursor ELSE NULL END,
           started_at = CASE WHEN v.state = 'paused' AND v.mode = p_mode THEN v.started_at ELSE NOW() END
     WHERE id;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.template_rerun_pause()
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    UPDATE public.template_rerun_control SET state = 'paused' WHERE id AND state = 'running';
$$;

CREATE OR REPLACE FUNCTION public.template_rerun_claim(p_lease_seconds INT)
RETURNS TABLE (mode TEXT, cursor UUID)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    UPDATE public.template_rerun_control
       SET lease_until = NOW() + make_interval(secs => GREATEST(10, COALESCE(p_lease_seconds, 90)))
     WHERE id AND state = 'running' AND (lease_until IS NULL OR lease_until < NOW())
    RETURNING template_rerun_control.mode, template_rerun_control.cursor;
$$;

CREATE OR REPLACE FUNCTION public.template_rerun_progress(p_cursor UUID, p_finished BOOLEAN)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    UPDATE public.template_rerun_control
       SET cursor = p_cursor,
           lease_until = NULL,
           state = CASE WHEN p_finished AND state = 'running' THEN 'idle' ELSE state END,
           finished_at = CASE WHEN p_finished AND state = 'running' THEN NOW() ELSE finished_at END
     WHERE id;
$$;

-- pg_cron (every 5 min) -> pg_net POST {app_base_url}/api/admin/template-rerun/run with the shared cron token
-- (public.sync_settings, see 20261027000000_intervals_auto_sync.sql). A no-op unless the job is running.
CREATE OR REPLACE FUNCTION public.template_rerun_trigger()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_url TEXT;
    v_token TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.template_rerun_control WHERE id AND state = 'running') THEN
        RETURN;
    END IF;
    SELECT value INTO v_url FROM public.sync_settings WHERE key = 'app_base_url';
    SELECT value INTO v_token FROM public.sync_settings WHERE key = 'cron_token';
    IF NULLIF(btrim(v_url), '') IS NULL OR v_token IS NULL THEN
        RETURN;
    END IF;
    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/api/admin/template-rerun/run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'template_rerun_trigger failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.template_rerun_batch(UUID, INT, BOOLEAN), public.template_rerun_retry_batch(UUID, INT),
    public.template_rerun_apply(UUID, JSONB, JSONB, TIMESTAMPTZ), public.template_rerun_restore(UUID),
    public.template_rerun_counts(), public.template_rerun_start(TEXT, UUID), public.template_rerun_pause(),
    public.template_rerun_claim(INT), public.template_rerun_progress(UUID, BOOLEAN), public.template_rerun_trigger()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.template_rerun_batch(UUID, INT, BOOLEAN), public.template_rerun_retry_batch(UUID, INT),
    public.template_rerun_apply(UUID, JSONB, JSONB, TIMESTAMPTZ), public.template_rerun_restore(UUID),
    public.template_rerun_counts(), public.template_rerun_start(TEXT, UUID), public.template_rerun_pause(),
    public.template_rerun_claim(INT), public.template_rerun_progress(UUID, BOOLEAN)
    TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'template-rerun') THEN
        PERFORM cron.unschedule('template-rerun');
    END IF;
    PERFORM cron.schedule('template-rerun', '*/5 * * * *', 'SELECT public.template_rerun_trigger()');
END;
$$;
