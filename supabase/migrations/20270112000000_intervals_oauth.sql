-- Intervals.icu OAuth (#312): the OAuth access token lives in connections.access_token (secret, service-role only).
-- auth_method is a non-secret, derived marker so the UI can offer "Reconnect with one click" to API-key riders.
ALTER TABLE public.connections
    ADD COLUMN IF NOT EXISTS auth_method TEXT GENERATED ALWAYS AS (
        CASE
            WHEN status = 'disconnected' THEN NULL
            WHEN access_token IS NOT NULL AND provider = 'intervals' THEN 'oauth'
            WHEN api_key IS NOT NULL THEN 'api_key'
            ELSE NULL
        END
    ) STORED;

GRANT SELECT (auth_method) ON public.connections TO authenticated;

-- Connecting with an API key replaces any OAuth token.
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
            access_token = NULL,
            status = 'active',
            last_error = NULL,
            backfill_days = EXCLUDED.backfill_days,
            updated_at = NOW();
END;
$$;
