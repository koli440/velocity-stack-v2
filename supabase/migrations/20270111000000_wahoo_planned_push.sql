-- Push planned workouts to Wahoo Cloud (#311, same design as the Intervals.icu push of #202). Additive and idempotent.
--
--  * planned_workout_wahoo_pushes: mapping planned workout -> Wahoo plan id + Wahoo workout id (+ pushed hash,
--    status, last error). Service-role writes only; the rider and the rider's ACTIVE coach may read. No FK on
--    workout_id on purpose: a deleted workout leaves a 'pending_delete' tombstone so the Wahoo records can still
--    be removed.
--  * connections.push_planned_workouts / planned_push_* (see the Intervals migration) are reused for the
--    provider = 'wahoo' row as the rider's opt-in for the scheduled push.
--  * set_wahoo_push_enabled / wahoo_push_context mirror the Intervals functions; no secrets are returned.
--  * sync_trigger_planned_push() now also fires for Wahoo riders; the existing pg_cron job and endpoint
--    (/api/planned-workouts/push/run) run both providers.

CREATE TABLE IF NOT EXISTS public.planned_workout_wahoo_pushes (
    workout_id UUID PRIMARY KEY,
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    wahoo_plan_id TEXT,
    wahoo_workout_id TEXT,
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
CREATE INDEX IF NOT EXISTS planned_workout_wahoo_pushes_rider_idx
    ON public.planned_workout_wahoo_pushes (rider_id, push_status);

ALTER TABLE public.planned_workout_wahoo_pushes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planned_workout_wahoo_pushes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.planned_workout_wahoo_pushes TO authenticated;
GRANT ALL ON public.planned_workout_wahoo_pushes TO service_role;

DROP POLICY IF EXISTS planned_workout_wahoo_pushes_select ON public.planned_workout_wahoo_pushes;
CREATE POLICY planned_workout_wahoo_pushes_select ON public.planned_workout_wahoo_pushes
    FOR SELECT TO authenticated
    USING (push_status <> 'pending_delete' AND (rider_id = auth.uid() OR public.is_coach_of(rider_id)));

-- Deleting a planned workout keeps a tombstone when it was pushed to Wahoo.
CREATE OR REPLACE FUNCTION public.planned_workouts_wahoo_push_tombstone()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.rider_id) THEN
        RETURN OLD;
    END IF;
    UPDATE public.planned_workout_wahoo_pushes
       SET push_status = 'pending_delete', claimed_until = NULL, last_error = NULL, updated_at = NOW()
     WHERE workout_id = OLD.id AND (wahoo_workout_id IS NOT NULL OR wahoo_plan_id IS NOT NULL);
    DELETE FROM public.planned_workout_wahoo_pushes
     WHERE workout_id = OLD.id AND wahoo_workout_id IS NULL AND wahoo_plan_id IS NULL;
    RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.planned_workouts_wahoo_push_tombstone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS planned_workouts_wahoo_push_tombstone ON public.planned_workouts;
CREATE TRIGGER planned_workouts_wahoo_push_tombstone
    AFTER DELETE ON public.planned_workouts
    FOR EACH ROW EXECUTE FUNCTION public.planned_workouts_wahoo_push_tombstone();

-- Disconnecting Wahoo (or switching to another Wahoo user) forgets the mappings and turns the auto push off.
CREATE OR REPLACE FUNCTION public.connections_reset_wahoo_planned_push()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.provider = 'wahoo'
       AND (NEW.status = 'disconnected' AND OLD.status IS DISTINCT FROM 'disconnected'
            OR NEW.external_athlete_id IS DISTINCT FROM OLD.external_athlete_id) THEN
        NEW.push_planned_workouts := FALSE;
        NEW.planned_push_error := NULL;
        DELETE FROM public.planned_workout_wahoo_pushes WHERE rider_id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.connections_reset_wahoo_planned_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS connections_reset_wahoo_planned_push ON public.connections;
CREATE TRIGGER connections_reset_wahoo_planned_push
    BEFORE UPDATE OF status, external_athlete_id ON public.connections
    FOR EACH ROW EXECUTE FUNCTION public.connections_reset_wahoo_planned_push();

-- The rider's own switch. Enabling requires an active Wahoo connection.
CREATE OR REPLACE FUNCTION public.set_wahoo_push_enabled(p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(p_enabled, FALSE) AND NOT EXISTS (
        SELECT 1 FROM public.connections
         WHERE user_id = auth.uid() AND provider = 'wahoo' AND status = 'active') THEN
        RAISE EXCEPTION 'Connect Wahoo first' USING ERRCODE = '22023';
    END IF;
    UPDATE public.connections
       SET push_planned_workouts = COALESCE(p_enabled, FALSE), planned_push_error = NULL, updated_at = NOW()
     WHERE user_id = auth.uid() AND provider = 'wahoo';
END;
$$;
REVOKE ALL ON FUNCTION public.set_wahoo_push_enabled(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_wahoo_push_enabled(BOOLEAN) TO authenticated;

-- What the push controls may know about the rider's Wahoo connection (rider or ACTIVE coach). No secrets/ids.
CREATE OR REPLACE FUNCTION public.wahoo_push_context(p_rider UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    c public.connections%ROWTYPE;
BEGIN
    IF NOT public.planned_workouts_can_plan(p_rider) THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;
    SELECT * INTO c FROM public.connections WHERE user_id = p_rider AND provider = 'wahoo';
    RETURN jsonb_build_object(
        'connected', FOUND AND c.status = 'active',
        'auto_enabled', FOUND AND c.status = 'active' AND c.push_planned_workouts,
        'is_self', p_rider = auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.wahoo_push_context(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wahoo_push_context(UUID) TO authenticated;

-- Cron entry point: Intervals.icu riders (unchanged) and now Wahoo riders too.
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
         WHERE c.status = 'active'
           AND ((c.provider = 'intervals' AND c.api_key IS NOT NULL)
                OR (c.provider = 'wahoo' AND c.refresh_token IS NOT NULL))
           AND (c.push_planned_workouts
                OR EXISTS (SELECT 1 FROM public.planned_workout_pushes p
                            WHERE p.rider_id = c.user_id AND c.provider = 'intervals' AND p.push_status = 'pending_delete')
                OR EXISTS (SELECT 1 FROM public.planned_workout_wahoo_pushes p
                            WHERE p.rider_id = c.user_id AND c.provider = 'wahoo' AND p.push_status = 'pending_delete'))
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
