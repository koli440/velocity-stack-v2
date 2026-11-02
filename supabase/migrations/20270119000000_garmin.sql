-- Direct Garmin Connect integration (#310): Activity API (pushed .fit files) + Training API (workout push).
-- Additive and idempotent.
--
-- * connections.provider and activities.source accept 'garmin'.
-- * activity_source_priority(): intervals 3 = wahoo 3 = garmin 3 > strava 2 > other 1 (Garmin rides arrive as .fit, so
--   they replace a Strava copy; against Intervals.icu/Wahoo it is a tie and the first copy wins).
-- * garmin_activity_events: queue of pushed activity files (Garmin Starter delivers by push only). The webhook stores
--   the pointer, the sync downloads and imports it. Service role only.
-- * planned_workout_garmin_pushes + helpers: planned workout -> Garmin workout + schedule entry (same design as the
--   Wahoo push). sync_trigger_planned_push() now also fires for Garmin riders.
-- * pg_cron 'garmin-sync' (every 15 min): safety net that imports queued events.
-- Garmin env vars live in the hosting settings, never here.

ALTER TABLE public.connections DROP CONSTRAINT IF EXISTS connections_provider_check;
ALTER TABLE public.connections ADD CONSTRAINT connections_provider_check
    CHECK (provider IN ('intervals', 'strava', 'wahoo', 'garmin'));

ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_source_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_source_check
    CHECK (source IN ('manual', 'intervals', 'strava', 'wahoo', 'garmin', 'bot')) NOT VALID;

CREATE OR REPLACE FUNCTION public.activity_source_priority(p_source TEXT)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE p_source WHEN 'intervals' THEN 3 WHEN 'wahoo' THEN 3 WHEN 'garmin' THEN 3 WHEN 'strava' THEN 2 ELSE 1 END;
$$;

CREATE TABLE IF NOT EXISTS public.garmin_activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    summary_id TEXT NOT NULL,
    callback_url TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'FIT',
    start_time_s BIGINT,
    start_offset_s INTEGER,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'imported', 'skipped', 'error')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, summary_id)
);
CREATE INDEX IF NOT EXISTS garmin_activity_events_pending_idx
    ON public.garmin_activity_events (user_id, status, received_at);

ALTER TABLE public.garmin_activity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.garmin_activity_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.garmin_activity_events TO service_role;

CREATE OR REPLACE FUNCTION public.sync_trigger_garmin()
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
        SELECT 1 FROM public.connections
        WHERE provider = 'garmin' AND status = 'active' AND refresh_token IS NOT NULL
    ) THEN
        RETURN;
    END IF;

    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/api/sync/garmin/run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_trigger_garmin failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_trigger_garmin() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'garmin-sync') THEN
        PERFORM cron.unschedule('garmin-sync');
    END IF;
    PERFORM cron.schedule('garmin-sync', '*/15 * * * *', 'SELECT public.sync_trigger_garmin()');
END;
$$;

-- Workout push (Training API). No FK on workout_id: a deleted workout leaves a 'pending_delete' tombstone.
CREATE TABLE IF NOT EXISTS public.planned_workout_garmin_pushes (
    workout_id UUID PRIMARY KEY,
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    garmin_workout_id TEXT,
    garmin_schedule_id TEXT,
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
CREATE INDEX IF NOT EXISTS planned_workout_garmin_pushes_rider_idx
    ON public.planned_workout_garmin_pushes (rider_id, push_status);

ALTER TABLE public.planned_workout_garmin_pushes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planned_workout_garmin_pushes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.planned_workout_garmin_pushes TO authenticated;
GRANT ALL ON public.planned_workout_garmin_pushes TO service_role;

DROP POLICY IF EXISTS planned_workout_garmin_pushes_select ON public.planned_workout_garmin_pushes;
CREATE POLICY planned_workout_garmin_pushes_select ON public.planned_workout_garmin_pushes
    FOR SELECT TO authenticated
    USING (push_status <> 'pending_delete' AND (rider_id = auth.uid() OR public.is_coach_of(rider_id)));

CREATE OR REPLACE FUNCTION public.planned_workouts_garmin_push_tombstone()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.rider_id) THEN
        RETURN OLD;
    END IF;
    UPDATE public.planned_workout_garmin_pushes
       SET push_status = 'pending_delete', claimed_until = NULL, last_error = NULL, updated_at = NOW()
     WHERE workout_id = OLD.id AND (garmin_workout_id IS NOT NULL OR garmin_schedule_id IS NOT NULL);
    DELETE FROM public.planned_workout_garmin_pushes
     WHERE workout_id = OLD.id AND garmin_workout_id IS NULL AND garmin_schedule_id IS NULL;
    RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.planned_workouts_garmin_push_tombstone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS planned_workouts_garmin_push_tombstone ON public.planned_workouts;
CREATE TRIGGER planned_workouts_garmin_push_tombstone
    AFTER DELETE ON public.planned_workouts
    FOR EACH ROW EXECUTE FUNCTION public.planned_workouts_garmin_push_tombstone();

-- Disconnecting Garmin (or switching to another Garmin user) forgets the mappings and turns the auto push off.
CREATE OR REPLACE FUNCTION public.connections_reset_garmin_planned_push()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.provider = 'garmin'
       AND (NEW.status = 'disconnected' AND OLD.status IS DISTINCT FROM 'disconnected'
            OR NEW.external_athlete_id IS DISTINCT FROM OLD.external_athlete_id) THEN
        NEW.push_planned_workouts := FALSE;
        NEW.planned_push_error := NULL;
        DELETE FROM public.planned_workout_garmin_pushes WHERE rider_id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.connections_reset_garmin_planned_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS connections_reset_garmin_planned_push ON public.connections;
CREATE TRIGGER connections_reset_garmin_planned_push
    BEFORE UPDATE OF status, external_athlete_id ON public.connections
    FOR EACH ROW EXECUTE FUNCTION public.connections_reset_garmin_planned_push();

CREATE OR REPLACE FUNCTION public.set_garmin_push_enabled(p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(p_enabled, FALSE) AND NOT EXISTS (
        SELECT 1 FROM public.connections
         WHERE user_id = auth.uid() AND provider = 'garmin' AND status = 'active') THEN
        RAISE EXCEPTION 'Connect Garmin first' USING ERRCODE = '22023';
    END IF;
    UPDATE public.connections
       SET push_planned_workouts = COALESCE(p_enabled, FALSE), planned_push_error = NULL, updated_at = NOW()
     WHERE user_id = auth.uid() AND provider = 'garmin';
END;
$$;
REVOKE ALL ON FUNCTION public.set_garmin_push_enabled(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_garmin_push_enabled(BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.garmin_push_context(p_rider UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    c public.connections%ROWTYPE;
BEGIN
    IF NOT public.planned_workouts_can_plan(p_rider) THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;
    SELECT * INTO c FROM public.connections WHERE user_id = p_rider AND provider = 'garmin';
    RETURN jsonb_build_object(
        'connected', FOUND AND c.status = 'active',
        'auto_enabled', FOUND AND c.status = 'active' AND c.push_planned_workouts,
        'is_self', p_rider = auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.garmin_push_context(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.garmin_push_context(UUID) TO authenticated;

-- Cron entry point: Intervals.icu, Wahoo and now Garmin riders.
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
                OR (c.provider IN ('wahoo', 'garmin') AND c.refresh_token IS NOT NULL))
           AND (c.push_planned_workouts
                OR EXISTS (SELECT 1 FROM public.planned_workout_pushes p
                            WHERE p.rider_id = c.user_id AND c.provider = 'intervals' AND p.push_status = 'pending_delete')
                OR EXISTS (SELECT 1 FROM public.planned_workout_wahoo_pushes p
                            WHERE p.rider_id = c.user_id AND c.provider = 'wahoo' AND p.push_status = 'pending_delete')
                OR EXISTS (SELECT 1 FROM public.planned_workout_garmin_pushes p
                            WHERE p.rider_id = c.user_id AND c.provider = 'garmin' AND p.push_status = 'pending_delete'))
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
