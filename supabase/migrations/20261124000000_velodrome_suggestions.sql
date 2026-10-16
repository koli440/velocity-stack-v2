-- VelocityStack: user-suggested velodrome info and edits with admin approval (issue #168, epic #179)
-- Registers `tracks` as a suggestion target and adds website / pricing / booking link columns.
-- Changes are never applied instantly: they go through public.suggestions + review_suggestion().

ALTER TABLE public.tracks
    ADD COLUMN IF NOT EXISTS website_url TEXT,
    ADD COLUMN IF NOT EXISTS pricing_url TEXT,
    ADD COLUMN IF NOT EXISTS booking_url TEXT;

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_links_http;
ALTER TABLE public.tracks
    ADD CONSTRAINT tracks_links_http CHECK (
        (website_url IS NULL OR website_url ~* '^https?://[^[:space:]]+$')
        AND (pricing_url IS NULL OR pricing_url ~* '^https?://[^[:space:]]+$')
        AND (booking_url IS NULL OR booking_url ~* '^https?://[^[:space:]]+$')
    ) NOT VALID;

INSERT INTO public.suggestion_targets (entity_type, table_name, id_column, label, allowed_columns)
VALUES (
    'velodrome', 'tracks', 'id', 'Velodrome',
    ARRAY['name', 'location', 'country_code', 'length_m', 'surface', 'is_indoor', 'elevation_m',
          'latitude', 'longitude', 'notes', 'website_url', 'pricing_url', 'booking_url']
)
ON CONFLICT (entity_type) DO UPDATE
    SET table_name = EXCLUDED.table_name,
        id_column = EXCLUDED.id_column,
        label = EXCLUDED.label,
        allowed_columns = EXCLUDED.allowed_columns;

-- Reject non-http(s) links at submission time so admins never see javascript: URLs etc.
CREATE OR REPLACE FUNCTION public.validate_velodrome_suggestion()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    k TEXT;
    v TEXT;
BEGIN
    IF NEW.entity_type <> 'velodrome' THEN
        RETURN NEW;
    END IF;
    FOREACH k IN ARRAY ARRAY['website_url', 'pricing_url', 'booking_url'] LOOP
        v := NEW.payload ->> k;
        IF v IS NOT NULL AND v <> '' AND v !~* '^https?://[^[:space:]]+$' THEN
            RAISE EXCEPTION 'Field "%" must be an http(s) link', k;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_velodrome_suggestion ON public.suggestions;
CREATE TRIGGER trg_validate_velodrome_suggestion
    BEFORE INSERT ON public.suggestions
    FOR EACH ROW EXECUTE FUNCTION public.validate_velodrome_suggestion();
