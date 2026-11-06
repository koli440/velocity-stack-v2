-- Garmin workout push: the rider's power target type (what the Edge shows as the step's power field).
-- Default POWER_LAP = interval (lap) average; the push hash includes it, so changing it re-sends pushed workouts.
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS push_power_target TEXT NOT NULL DEFAULT 'POWER_LAP';

ALTER TABLE public.connections DROP CONSTRAINT IF EXISTS connections_push_power_target_check;
ALTER TABLE public.connections
    ADD CONSTRAINT connections_push_power_target_check
    CHECK (push_power_target IN ('POWER', 'POWER_3S', 'POWER_10S', 'POWER_30S', 'POWER_LAP'));

CREATE OR REPLACE FUNCTION public.set_garmin_power_target(p_target TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_target IS NULL OR p_target NOT IN ('POWER', 'POWER_3S', 'POWER_10S', 'POWER_30S', 'POWER_LAP') THEN
        RAISE EXCEPTION 'Unknown power target' USING ERRCODE = '22023';
    END IF;
    UPDATE public.connections
       SET push_power_target = p_target, updated_at = NOW()
     WHERE user_id = auth.uid() AND provider = 'garmin';
END;
$$;
REVOKE ALL ON FUNCTION public.set_garmin_power_target(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_garmin_power_target(TEXT) TO authenticated;

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
        'power_target', COALESCE(c.push_power_target, 'POWER_LAP'),
        'is_self', p_rider = auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.garmin_push_context(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.garmin_push_context(UUID) TO authenticated;
