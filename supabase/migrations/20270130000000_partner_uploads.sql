-- Partner upload API (POST /api/v1/activities): one row per upload, idempotent per (app, rider, external_id).
-- Additive and idempotent. Partner activities use activities.source = 'partner' and
-- external_source = 'partner:<app slug>' so no migration is needed per app.
-- activity_source_priority(): partner = strava = 2 (equal to Strava, so the first copy wins; a .fit-based copy from
-- Intervals/Wahoo/Garmin still replaces a Strava copy, and a partner copy is never silently replaced).

ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_source_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_source_check
    CHECK (source IN ('manual', 'intervals', 'strava', 'wahoo', 'garmin', 'partner', 'bot')) NOT VALID;

CREATE OR REPLACE FUNCTION public.activity_source_priority(p_source TEXT)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE p_source WHEN 'intervals' THEN 3 WHEN 'wahoo' THEN 3 WHEN 'garmin' THEN 3 WHEN 'strava' THEN 2 WHEN 'partner' THEN 2 ELSE 1 END;
$$;

CREATE TABLE IF NOT EXISTS public.partner_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES public.developer_apps(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'duplicate', 'failed')),
    activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'json' CHECK (kind IN ('json', 'fit', 'tcx', 'gpx')),
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (app_id, user_id, external_id)
);
CREATE INDEX IF NOT EXISTS partner_uploads_app_day_idx ON public.partner_uploads (app_id, created_at);

ALTER TABLE public.partner_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_uploads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.partner_uploads TO service_role;
