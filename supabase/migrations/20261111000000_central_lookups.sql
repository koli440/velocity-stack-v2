-- #177: central lookups (countries, surfaces, disciplines), tracks.is_indoor and velodrome cleanup.
-- Idempotent; safe to re-run.

-- 1. Surfaces -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.surfaces (
    name TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO public.surfaces (name, sort_order) VALUES
    ('Wood', 1), ('Concrete', 2), ('Asphalt', 3), ('Aluminium', 4)
ON CONFLICT (name) DO NOTHING;

-- Normalise free-text surfaces from the v1 import onto the lookup values.
UPDATE public.tracks SET surface = 'Asphalt' WHERE surface IN ('Bitumen', 'Tarmac');
UPDATE public.tracks SET surface = 'Wood' WHERE surface = 'Timber';
INSERT INTO public.surfaces (name, sort_order)
SELECT DISTINCT surface, 99 FROM public.tracks WHERE surface IS NOT NULL
ON CONFLICT (name) DO NOTHING;

-- 2. Countries (codes are the UCI/IOC-style 3-letter codes already used by tracks.country_code)
CREATE TABLE IF NOT EXISTS public.countries (
    code VARCHAR(3) PRIMARY KEY,
    name TEXT NOT NULL
);
INSERT INTO public.countries (code, name) VALUES
    ('ARE','United Arab Emirates'),('ARG','Argentina'),('AUS','Australia'),('AUT','Austria'),
    ('BEL','Belgium'),('BOL','Bolivia'),('BRA','Brazil'),('BUL','Bulgaria'),('CAN','Canada'),
    ('CHI','Chile'),('CHN','China'),('COL','Colombia'),('CZE','Czechia'),('DNK','Denmark'),
    ('ESP','Spain'),('FIN','Finland'),('FRA','France'),('GBR','United Kingdom'),('GER','Germany'),
    ('GRE','Greece'),('INA','Indonesia'),('IND','India'),('ISR','Israel'),('ITA','Italy'),
    ('JPN','Japan'),('KAZ','Kazakhstan'),('LTU','Lithuania'),('MAS','Malaysia'),('MEX','Mexico'),
    ('NED','Netherlands'),('NOR','Norway'),('NZL','New Zealand'),('PER','Peru'),('POL','Poland'),
    ('POR','Portugal'),('QAT','Qatar'),('SLO','Slovenia'),('SUI','Switzerland'),('SWE','Sweden'),
    ('THA','Thailand'),('TTO','Trinidad and Tobago'),('TUR','Turkey'),('UKR','Ukraine'),
    ('USA','United States'),('VEN','Venezuela')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name)
SELECT DISTINCT country_code, country_code FROM public.tracks WHERE country_code IS NOT NULL
ON CONFLICT (code) DO NOTHING;

-- 3. Disciplines (seeded from the PB Vault list) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.disciplines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    distance_m NUMERIC(8, 2) NOT NULL CHECK (distance_m > 0),
    flying_start BOOLEAN NOT NULL DEFAULT FALSE,
    gender TEXT NOT NULL DEFAULT 'open' CHECK (gender IN ('open', 'men', 'women', 'mixed')),
    age_group TEXT NOT NULL DEFAULT 'open',
    min_track_length_m NUMERIC(6, 2),
    max_track_length_m NUMERIC(6, 2),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO public.disciplines (name, category, distance_m, flying_start, sort_order) VALUES
    ('200m Flying', 'Sprint', 200, TRUE, 1),
    ('500m TT', 'Time Trial', 500, FALSE, 2),
    ('666m TT', 'Time Trial', 666, FALSE, 3),
    ('750m TT', 'Time Trial', 750, FALSE, 4),
    ('750m Team Sprint', 'Time Trial', 750, FALSE, 5),
    ('800m TT', 'Time Trial', 800, FALSE, 6),
    ('1000m TT', 'Time Trial', 1000, FALSE, 7),
    ('2000m Individual Pursuit', 'Endurance', 2000, FALSE, 8),
    ('3000m Individual Pursuit', 'Endurance', 3000, FALSE, 9),
    ('4000m Individual Pursuit', 'Endurance', 4000, FALSE, 10),
    ('4000m Team Pursuit', 'Endurance', 4000, FALSE, 11),
    ('BMX Race', 'BMX', 350, FALSE, 12)
ON CONFLICT (name) DO NOTHING;

-- 4. Velodrome cleanup ------------------------------------------------------------------------
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS is_indoor BOOLEAN;

-- Map duplicates (same country, ~same length, within ~0.01 deg; or same name ignoring case) to
-- the oldest row of the pair and repoint references before deleting.
CREATE TEMP TABLE _track_dupes ON COMMIT DROP AS
SELECT DISTINCT ON (d.id) d.id AS dup_id, k.id AS keep_id
FROM public.tracks d
JOIN public.tracks k
  ON k.id <> d.id
 AND (k.created_at, k.id::text) < (d.created_at, d.id::text)
 AND (
      lower(trim(k.name)) = lower(trim(d.name))
      OR (
        k.country_code = d.country_code
        AND k.latitude IS NOT NULL AND d.latitude IS NOT NULL
        AND round(k.length_m) = round(d.length_m)
        AND abs(k.latitude - d.latitude) <= 0.01
        AND abs(k.longitude - d.longitude) <= 0.01
      )
 )
ORDER BY d.id, k.created_at, k.id::text;

UPDATE public.activities a SET track_id = m.keep_id FROM _track_dupes m WHERE a.track_id = m.dup_id;
UPDATE public.personal_bests p SET track_id = m.keep_id FROM _track_dupes m WHERE p.track_id = m.dup_id;
UPDATE public.aero_tests p SET track_id = m.keep_id FROM _track_dupes m WHERE p.track_id = m.dup_id;
UPDATE public.profiles p SET home_track_id = m.keep_id FROM _track_dupes m WHERE p.home_track_id = m.dup_id;
DELETE FROM public.tracks t USING _track_dupes m WHERE t.id = m.dup_id;

-- Backfill is_indoor: wooden tracks are indoor unless known otherwise; the rest outdoor.
UPDATE public.tracks SET is_indoor = (surface = 'Wood') WHERE is_indoor IS NULL;
UPDATE public.tracks SET is_indoor = TRUE WHERE name = 'Lviv Velodrome (SKA)';
UPDATE public.tracks SET is_indoor = FALSE WHERE name IN ('Dick Lane Velodrome', 'Třebešín Velodrome');
ALTER TABLE public.tracks ALTER COLUMN is_indoor SET DEFAULT FALSE;
ALTER TABLE public.tracks ALTER COLUMN is_indoor SET NOT NULL;

-- Oderlandhalle (Frankfurt (Oder), Germany): 250 m indoor wooden track.
INSERT INTO public.tracks (name, location, country_code, length_m, surface, latitude, longitude, is_indoor, notes)
SELECT 'Oderlandhalle', 'Frankfurt (Oder), Germany', 'GER', 250.00, 'Wood', 52.3394, 14.5500, TRUE,
       'Indoor 250 m wooden velodrome'
WHERE NOT EXISTS (
    SELECT 1 FROM public.tracks WHERE lower(name) LIKE '%oderlandhalle%'
);

-- 5. Foreign keys + RLS ------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracks_country_code_fkey') THEN
        ALTER TABLE public.tracks ADD CONSTRAINT tracks_country_code_fkey
            FOREIGN KEY (country_code) REFERENCES public.countries(code);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracks_surface_fkey') THEN
        ALTER TABLE public.tracks ADD CONSTRAINT tracks_surface_fkey
            FOREIGN KEY (surface) REFERENCES public.surfaces(name);
    END IF;
END $$;

ALTER TABLE public.surfaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lookups are readable" ON public.surfaces;
DROP POLICY IF EXISTS "Lookups are readable" ON public.countries;
DROP POLICY IF EXISTS "Lookups are readable" ON public.disciplines;
CREATE POLICY "Lookups are readable" ON public.surfaces FOR SELECT USING (true);
CREATE POLICY "Lookups are readable" ON public.countries FOR SELECT USING (true);
CREATE POLICY "Lookups are readable" ON public.disciplines FOR SELECT USING (true);
