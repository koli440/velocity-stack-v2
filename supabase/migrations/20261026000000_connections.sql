-- Connections (#109 step 3): one row per (user, provider) for automatic activity import.
-- Additive and idempotent. profile_secrets is kept untouched for backward compatibility.
--
-- Secret columns (api_key, access_token, refresh_token) are NOT readable by clients: table access is
-- limited to column grants on the non-secret fields. Writes go through the SECURITY DEFINER functions
-- below (own row only). Secrets are read server-side with the service role (or by pg_cron jobs).

CREATE TABLE IF NOT EXISTS public.connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('intervals', 'strava')),
    external_athlete_id TEXT,          -- Intervals athlete id (iXXXX) / Strava athlete id
    api_key TEXT,                      -- Intervals only (secret)
    access_token TEXT,                 -- Strava only (secret)
    refresh_token TEXT,                -- Strava only (secret)
    token_expires_at TIMESTAMPTZ,      -- Strava only
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'disconnected')),
    last_error TEXT,
    last_synced_at TIMESTAMPTZ,
    backfill_days INTEGER DEFAULT 30 CHECK (backfill_days IS NULL OR backfill_days BETWEEN 1 AND 36500),  -- NULL = full history
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, provider)
);

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "connections_select_own" ON public.connections;
CREATE POLICY "connections_select_own" ON public.connections FOR SELECT USING (auth.uid() = user_id);

-- Clients: read non-secret columns only, no direct writes.
REVOKE ALL ON public.connections FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, user_id, provider, external_athlete_id, status, last_error, last_synced_at,
              backfill_days, created_at, updated_at)
    ON public.connections TO authenticated;

-- Existing Intervals credentials -> connections (never overwrites an existing connection row).
INSERT INTO public.connections (user_id, provider, external_athlete_id, api_key, status)
SELECT s.user_id, 'intervals', btrim(s.intervals_athlete_id), btrim(s.intervals_api_key), 'active'
FROM public.profile_secrets s
WHERE NULLIF(btrim(s.intervals_athlete_id), '') IS NOT NULL
  AND NULLIF(btrim(s.intervals_api_key), '') IS NOT NULL
ON CONFLICT (user_id, provider) DO NOTHING;

-- Connect Intervals.icu for the caller. p_backfill_days NULL = full history.
CREATE OR REPLACE FUNCTION public.connect_intervals(
    p_athlete_id TEXT, p_api_key TEXT, p_backfill_days INTEGER DEFAULT 30
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    IF NULLIF(btrim(p_athlete_id), '') IS NULL OR NULLIF(btrim(p_api_key), '') IS NULL THEN
        RAISE EXCEPTION 'athlete id and api key are required' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.connections (user_id, provider, external_athlete_id, api_key, status, last_error, backfill_days)
    VALUES (auth.uid(), 'intervals', btrim(p_athlete_id), btrim(p_api_key), 'active', NULL, p_backfill_days)
    ON CONFLICT (user_id, provider) DO UPDATE
        SET external_athlete_id = EXCLUDED.external_athlete_id,
            api_key = EXCLUDED.api_key,
            status = 'active',
            last_error = NULL,
            backfill_days = EXCLUDED.backfill_days,
            updated_at = NOW();
END;
$$;

-- Disconnect a provider for the caller: clears every secret/token, keeps the row (settings, history).
-- Also clears the legacy profile_secrets Intervals credentials.
CREATE OR REPLACE FUNCTION public.disconnect_connection(p_provider TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    UPDATE public.connections
    SET api_key = NULL, access_token = NULL, refresh_token = NULL, token_expires_at = NULL,
        external_athlete_id = NULL, status = 'disconnected', last_error = NULL, updated_at = NOW()
    WHERE user_id = auth.uid() AND provider = p_provider;
    IF p_provider = 'intervals' THEN
        UPDATE public.profile_secrets
        SET intervals_athlete_id = NULL, intervals_api_key = NULL, updated_at = NOW()
        WHERE user_id = auth.uid();
    END IF;
END;
$$;

-- Change the backfill window for the caller's connection. NULL = full history.
CREATE OR REPLACE FUNCTION public.set_connection_backfill(p_provider TEXT, p_backfill_days INTEGER)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_backfill_days IS NOT NULL AND (p_backfill_days < 1 OR p_backfill_days > 36500) THEN
        RAISE EXCEPTION 'backfill_days out of range' USING ERRCODE = '22023';
    END IF;
    UPDATE public.connections SET backfill_days = p_backfill_days, updated_at = NOW()
    WHERE user_id = auth.uid() AND provider = p_provider;
END;
$$;

-- Record a sync outcome for the caller's connection: NULL error = success (status active,
-- last_synced_at = now); otherwise status 'error' + last_error. Disconnected rows are left alone.
CREATE OR REPLACE FUNCTION public.record_connection_result(p_provider TEXT, p_error TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    UPDATE public.connections
    SET status = CASE WHEN p_error IS NULL THEN 'active' ELSE 'error' END,
        last_error = left(p_error, 500),
        last_synced_at = CASE WHEN p_error IS NULL THEN NOW() ELSE last_synced_at END,
        updated_at = NOW()
    WHERE user_id = auth.uid() AND provider = p_provider AND status <> 'disconnected';
END;
$$;

REVOKE ALL ON FUNCTION public.connect_intervals(TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.disconnect_connection(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_connection_backfill(TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_connection_result(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connect_intervals(TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_connection(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_connection_backfill(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_connection_result(TEXT, TEXT) TO authenticated;
