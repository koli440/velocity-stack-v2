-- Push planned workouts to Intervals.icu (#202). Additive and idempotent.
--
--  * planned_workout_pushes: mapping planned workout -> Intervals.icu event id (+ pushed hash, status, last error).
--    Service-role writes only. The rider and the rider's ACTIVE coach may read their own rows (no credentials in
--    it). workout_id has no FK on purpose: a deleted workout leaves a 'pending_delete' tombstone so the remote
--    event can be removed later, even though the workout row is gone.
--  * connections.push_planned_workouts (default FALSE) + attempt bookkeeping: per-rider opt-in for the
--    scheduled push. Non-secret columns.
--  * planned_push_context(rider): {connected, auto_enabled} for the UI, readable by rider / active coach, never
--    returns the key or the Intervals athlete id.
--  * pg_cron (every 15 min) -> pg_net POST /api/planned-workouts/push/run with the shared sync token
--    (same mechanism as intervals-sync; no external secrets).

CREATE TABLE IF NOT EXISTS public.planned_workout_pushes (
    workout_id UUID PRIMARY KEY,
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    intervals_event_id TEXT,
    pushed_hash TEXT,
    pushed_at TIMESTAMPTZ,
    pushed_date DATE,
    push_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (push_status IN ('pending', 'pushed', 'error', 'pending_delete')),
    attempted_hash TEXT,
    last_error TEXT,
    last_attempt_at TIMESTAMPTZ,
    claimed_until TIMESTAMPTZ,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS planned_workout_pushes_rider_idx
    ON public.planned_workout_pushes (rider_id, push_status);

ALTER TABLE public.planned_workout_pushes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planned_workout_pushes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.planned_workout_pushes TO authenticated;
GRANT ALL ON public.planned_workout_pushes TO service_role;

DROP POLICY IF EXISTS planned_workout_pushes_select ON public.planned_workout_pushes;
CREATE POLICY planned_workout_pushes_select ON public.planned_workout_pushes
    FOR SELECT TO authenticated
    USING (push_status <> 'pending_delete' AND (rider_id = auth.uid() OR public.is_coach_of(rider_id)));

-- Connection columns (non-secret).
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS push_planned_workouts BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS planned_push_attempt_at TIMESTAMPTZ;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS planned_push_at TIMESTAMPTZ;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS planned_push_error TEXT;
GRANT SELECT (push_planned_workouts, planned_push_at, planned_push_error) ON public.connections TO authenticated;

-- Deleting a planned workout keeps a tombstone when it was pushed.
CREATE OR REPLACE FUNCTION public.planned_workouts_push_tombstone()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.rider_id) THEN
        RETURN OLD;
    END IF;
    UPDATE public.planned_workout_pushes
       SET push_status = 'pending_delete', claimed_until = NULL, last_error = NULL, updated_at = NOW()
     WHERE workout_id = OLD.id AND intervals_event_id IS NOT NULL;
    DELETE FROM public.planned_workout_pushes WHERE workout_id = OLD.id AND intervals_event_id IS NULL;
    RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.planned_workouts_push_tombstone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS planned_workouts_push_tombstone ON public.planned_workouts;
CREATE TRIGGER planned_workouts_push_tombstone
    AFTER DELETE ON public.planned_workouts
    FOR EACH ROW EXECUTE FUNCTION public.planned_workouts_push_tombstone();

-- Disconnecting (or switching to another Intervals athlete) forgets the mappings and turns the auto push off:
-- the old events stay in the old calendar, and nothing may be updated/deleted in a different one.
CREATE OR REPLACE FUNCTION public.connections_reset_planned_push()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.provider = 'intervals'
       AND (NEW.status = 'disconnected' AND OLD.status IS DISTINCT FROM 'disconnected'
            OR NEW.external_athlete_id IS DISTINCT FROM OLD.external_athlete_id) THEN
        NEW.push_planned_workouts := FALSE;
        NEW.planned_push_error := NULL;
        DELETE FROM public.planned_workout_pushes WHERE rider_id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.connections_reset_planned_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS connections_reset_planned_push ON public.connections;
CREATE TRIGGER connections_reset_planned_push
    BEFORE UPDATE OF status, external_athlete_id ON public.connections
    FOR EACH ROW EXECUTE FUNCTION public.connections_reset_planned_push();

-- The rider's own switch. Enabling requires an active Intervals connection.
CREATE OR REPLACE FUNCTION public.set_planned_push_enabled(p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(p_enabled, FALSE) AND NOT EXISTS (
        SELECT 1 FROM public.connections
         WHERE user_id = auth.uid() AND provider = 'intervals' AND status = 'active') THEN
        RAISE EXCEPTION 'Connect Intervals.icu first' USING ERRCODE = '22023';
    END IF;
    UPDATE public.connections
       SET push_planned_workouts = COALESCE(p_enabled, FALSE), planned_push_error = NULL, updated_at = NOW()
     WHERE user_id = auth.uid() AND provider = 'intervals';
END;
$$;
REVOKE ALL ON FUNCTION public.set_planned_push_enabled(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_planned_push_enabled(BOOLEAN) TO authenticated;

-- What the push controls may know about the rider's connection (rider or ACTIVE coach). No secrets/ids.
CREATE OR REPLACE FUNCTION public.planned_push_context(p_rider UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    c public.connections%ROWTYPE;
BEGIN
    IF NOT public.planned_workouts_can_plan(p_rider) THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;
    SELECT * INTO c FROM public.connections WHERE user_id = p_rider AND provider = 'intervals';
    RETURN jsonb_build_object(
        'connected', FOUND AND c.status = 'active',
        'auto_enabled', FOUND AND c.status = 'active' AND c.push_planned_workouts,
        'is_self', p_rider = auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.planned_push_context(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planned_push_context(UUID) TO authenticated;

-- Cron entry point (silent no-op when not configured or nothing to do).
CREATE OR REPLACE FUNCTION public.sync_trigger_planned_push()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_url TEXT;
    v_token TEXT;
BEGIN
    SELECT value INTO v_url FROM public.sync_settings WHERE key = 'app_base_url';
    SELECT value INTO v_token FROM public.sync_settings WHERE key = 'cron_token';
    IF NULLIF(btrim(v_url), '') IS NULL OR v_token IS NULL THEN
        RETURN;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.connections c
         WHERE c.provider = 'intervals' AND c.status = 'active' AND c.api_key IS NOT NULL
           AND (c.push_planned_workouts
                OR EXISTS (SELECT 1 FROM public.planned_workout_pushes p
                            WHERE p.rider_id = c.user_id AND p.push_status = 'pending_delete'))
    ) THEN
        RETURN;
    END IF;

    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/api/planned-workouts/push/run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_trigger_planned_push failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_trigger_planned_push() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'planned-workout-push') THEN
        PERFORM cron.unschedule('planned-workout-push');
    END IF;
    PERFORM cron.schedule('planned-workout-push', '4,19,34,49 * * * *', 'SELECT public.sync_trigger_planned_push()');
END;
$$;
