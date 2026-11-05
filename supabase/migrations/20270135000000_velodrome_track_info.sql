-- VelocityStack: researched velodrome info (operator, year built, hours, price range, contacts,
-- open/closed status) with per-field provenance. Idempotent; safe to re-run.
-- Reuses website_url / pricing_url / booking_url from 20261124000000_velodrome_suggestions.sql.
-- Process: docs/velodrome-research/PROCESS.md

-- 1. New public columns on tracks --------------------------------------------------------
-- NOTE: `tracks` is readable by everyone (tracks_read_all). Everything below is public.
-- phone/email may ONLY hold organisational contacts (generic venue line / mailbox), never
-- personal or staff numbers; contact_is_organisational + the CHECK below make that explicit.
ALTER TABLE public.tracks
    ADD COLUMN IF NOT EXISTS operator TEXT,
    ADD COLUMN IF NOT EXISTS year_built SMALLINT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS contact_is_organisational BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS opening_hours TEXT,
    ADD COLUMN IF NOT EXISTS opening_hours_spec TEXT,
    ADD COLUMN IF NOT EXISTS price_min NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS price_max NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS price_currency CHAR(3),
    ADD COLUMN IF NOT EXISTS operating_status TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS operating_status_checked_at DATE,
    ADD COLUMN IF NOT EXISTS info_verified_at DATE;

COMMENT ON COLUMN public.tracks.phone IS 'PUBLIC. Organisational (generic venue) phone only; never personal/staff numbers.';
COMMENT ON COLUMN public.tracks.email IS 'PUBLIC. Organisational (generic venue) mailbox only; never personal/staff addresses.';
COMMENT ON COLUMN public.tracks.opening_hours IS 'Human-readable hours as published by the venue (free text).';
COMMENT ON COLUMN public.tracks.opening_hours_spec IS 'Optional schema.org openingHours entries, e.g. "Mo-Fr 06:00-22:00; Sa-Su 07:00-20:00". Used for JSON-LD only.';
COMMENT ON COLUMN public.tracks.info_verified_at IS 'Derived: most recent verified_at among current verified rows in track_info_sources (maintained by trigger).';
COMMENT ON COLUMN public.tracks.operating_status IS 'open | closed | unknown. unknown = never established from an official source.';

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_year_built_chk;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_year_built_chk
    CHECK (year_built IS NULL OR year_built BETWEEN 1850 AND 2100);

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_price_chk;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_price_chk CHECK (
    (price_min IS NULL OR price_min >= 0)
    AND (price_max IS NULL OR price_max >= 0)
    AND (price_min IS NULL OR price_max IS NULL OR price_min <= price_max)
    AND (price_currency IS NULL OR price_currency ~ '^[A-Z]{3}$')
    AND ((price_min IS NULL AND price_max IS NULL) OR price_currency IS NOT NULL)
);

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_operating_status_chk;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_operating_status_chk
    CHECK (operating_status IN ('open', 'closed', 'unknown'));

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_contact_chk;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_contact_chk CHECK (
    (phone IS NULL OR phone ~ '^\+?[0-9][0-9 ()./-]{4,24}$')
    AND (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    AND ((phone IS NULL AND email IS NULL) OR contact_is_organisational)
);

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_hours_spec_chk;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_hours_spec_chk CHECK (
    opening_hours_spec IS NULL OR opening_hours_spec ~
    '^(Mo|Tu|We|Th|Fr|Sa|Su)(-(Mo|Tu|We|Th|Fr|Sa|Su))? [0-2][0-9]:[0-5][0-9]-[0-2][0-9]:[0-5][0-9](; (Mo|Tu|We|Th|Fr|Sa|Su)(-(Mo|Tu|We|Th|Fr|Sa|Su))? [0-2][0-9]:[0-5][0-9]-[0-2][0-9]:[0-5][0-9])*$'
);

-- A human-edited opening_hours text must not keep a stale structured spec.
CREATE OR REPLACE FUNCTION public.tracks_clear_stale_hours_spec()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.opening_hours IS DISTINCT FROM OLD.opening_hours
       AND NEW.opening_hours_spec IS NOT DISTINCT FROM OLD.opening_hours_spec THEN
        NEW.opening_hours_spec := NULL;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tracks_clear_stale_hours_spec ON public.tracks;
CREATE TRIGGER trg_tracks_clear_stale_hours_spec
    BEFORE UPDATE ON public.tracks
    FOR EACH ROW EXECUTE FUNCTION public.tracks_clear_stale_hours_spec();

-- 2. Rider suggestions: which new columns may be proposed (admin-reviewed) ---------------
-- Not suggestible: phone / email / contact_is_organisational (personal-data risk in a public
-- table; set only by the research pipeline), opening_hours_spec, info_verified_at and
-- operating_status_checked_at (system-maintained).
INSERT INTO public.suggestion_targets (entity_type, table_name, id_column, label, allowed_columns)
VALUES (
    'velodrome', 'tracks', 'id', 'Velodrome',
    ARRAY['name', 'location', 'country_code', 'length_m', 'surface', 'is_indoor', 'elevation_m',
          'latitude', 'longitude', 'notes', 'website_url', 'pricing_url', 'booking_url',
          'operator', 'year_built', 'opening_hours', 'price_min', 'price_max', 'price_currency',
          'operating_status']
)
ON CONFLICT (entity_type) DO UPDATE
    SET table_name = EXCLUDED.table_name,
        id_column = EXCLUDED.id_column,
        label = EXCLUDED.label,
        allowed_columns = EXCLUDED.allowed_columns;

-- 3. Per-field provenance ------------------------------------------------------------------
-- One row per (track, field) check. The newest row is is_current; older rows stay as history.
-- status: verified | not_found (checked, nothing official found) | stale (page changed or
-- unreachable at re-check; not "wrong") | needs_attention (conflict / not auto-appliable).
CREATE TABLE IF NOT EXISTS public.track_info_sources (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
    field TEXT NOT NULL CHECK (field IN (
        'website_url', 'booking_url', 'pricing_url', 'operator', 'year_built', 'phone', 'email',
        'opening_hours', 'price_range', 'operating_status')),
    status TEXT NOT NULL CHECK (status IN ('verified', 'not_found', 'stale', 'needs_attention')),
    value TEXT,
    value_json JSONB,
    source_url TEXT CHECK (source_url IS NULL OR source_url ~* '^https?://[^[:space:]]+$'),
    source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('operator', 'owner', 'federation', 'other')),
    evidence_quote TEXT,
    confidence TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
    content_hash TEXT,
    verified_at DATE NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT track_info_sources_url_required CHECK (status = 'not_found' OR source_url IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS track_info_sources_current_uidx
    ON public.track_info_sources (track_id, field) WHERE is_current;
CREATE INDEX IF NOT EXISTS track_info_sources_track_idx ON public.track_info_sources (track_id);

ALTER TABLE public.track_info_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.track_info_sources FROM anon, authenticated;
GRANT SELECT ON public.track_info_sources TO anon, authenticated;

-- Public may only see current, verified provenance; not_found/stale/needs_attention rows are audit data.
DROP POLICY IF EXISTS "track_info_sources_read" ON public.track_info_sources;
CREATE POLICY "track_info_sources_read" ON public.track_info_sources
    FOR SELECT TO anon, authenticated USING (is_current AND status = 'verified');

-- Writes happen only via the service role (bypasses RLS) through upsert_track_info_source().
-- 4. Idempotent upsert used by the pipeline and quarterly refresh -------------------------
-- Same value + source + hash => just bump verified_at / status on the current row.
-- Otherwise the previous current row is demoted to history and a new current row is added.
CREATE OR REPLACE FUNCTION public.upsert_track_info_source(
    p_track_id UUID, p_field TEXT, p_status TEXT, p_value TEXT, p_value_json JSONB,
    p_source_url TEXT, p_source_kind TEXT, p_evidence_quote TEXT, p_confidence TEXT,
    p_content_hash TEXT, p_verified_at DATE DEFAULT CURRENT_DATE)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    cur public.track_info_sources;
    new_id BIGINT;
BEGIN
    SELECT * INTO cur FROM public.track_info_sources
    WHERE track_id = p_track_id AND field = p_field AND is_current FOR UPDATE;

    IF FOUND
       AND cur.status = p_status
       AND cur.value IS NOT DISTINCT FROM p_value
       AND cur.value_json IS NOT DISTINCT FROM p_value_json
       AND cur.source_url IS NOT DISTINCT FROM p_source_url
       AND (p_content_hash IS NULL OR cur.content_hash IS NOT DISTINCT FROM p_content_hash) THEN
        UPDATE public.track_info_sources
        SET verified_at = GREATEST(verified_at, p_verified_at),
            content_hash = COALESCE(p_content_hash, content_hash),
            evidence_quote = COALESCE(p_evidence_quote, evidence_quote),
            confidence = COALESCE(p_confidence, confidence)
        WHERE id = cur.id;
        RETURN cur.id;
    END IF;

    IF FOUND THEN
        UPDATE public.track_info_sources SET is_current = FALSE WHERE id = cur.id;
    END IF;
    INSERT INTO public.track_info_sources
        (track_id, field, status, value, value_json, source_url, source_kind, evidence_quote,
         confidence, content_hash, verified_at)
    VALUES (p_track_id, p_field, p_status, p_value, p_value_json, p_source_url, p_source_kind,
            p_evidence_quote, p_confidence, p_content_hash, p_verified_at)
    RETURNING id INTO new_id;
    RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_track_info_source(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_track_info_source(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, DATE) TO service_role;

-- 5. tracks.info_verified_at is derived from current verified provenance --------------------
CREATE OR REPLACE FUNCTION public.refresh_track_info_verified_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_track UUID := COALESCE(NEW.track_id, OLD.track_id);
BEGIN
    UPDATE public.tracks t
    SET info_verified_at = (SELECT MAX(s.verified_at) FROM public.track_info_sources s
                            WHERE s.track_id = v_track AND s.is_current AND s.status = 'verified')
    WHERE t.id = v_track;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_refresh_track_info_verified_at ON public.track_info_sources;
CREATE TRIGGER trg_refresh_track_info_verified_at
    AFTER INSERT OR UPDATE OR DELETE ON public.track_info_sources
    FOR EACH ROW EXECUTE FUNCTION public.refresh_track_info_verified_at();

-- 6. Quarterly refresh queue: current checks older than 90 days, stale ones, and never-checked
-- fields. Service role only.
CREATE OR REPLACE VIEW public.track_info_refresh_due AS
SELECT t.id AS track_id, f.field, s.status, s.verified_at,
       CASE WHEN s.id IS NULL THEN 'never_checked'
            WHEN s.status = 'stale' THEN 'stale'
            ELSE 'overdue' END AS reason
FROM public.tracks t
CROSS JOIN (VALUES ('website_url'), ('booking_url'), ('pricing_url'), ('operator'), ('year_built'),
                   ('phone'), ('email'), ('opening_hours'), ('price_range'), ('operating_status')) AS f(field)
LEFT JOIN public.track_info_sources s
       ON s.track_id = t.id AND s.field = f.field AND s.is_current
WHERE s.id IS NULL OR s.status = 'stale' OR s.verified_at < CURRENT_DATE - 90;
REVOKE ALL ON public.track_info_refresh_due FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.track_info_refresh_due TO service_role;

NOTIFY pgrst, 'reload schema';
