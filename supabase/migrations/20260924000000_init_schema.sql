-- Allow UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Velodromes 
CREATE TABLE IF NOT EXISTS public.tracks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    location TEXT,
    country_code VARCHAR(3),
    length_m NUMERIC(5, 2) NOT NULL,
    surface TEXT NOT NULL,
    banking_deg NUMERIC(4, 1),
    elevation_m NUMERIC(6, 1),
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    full_name TEXT,
    avatar_url TEXT,
    weight_kg NUMERIC(4, 1),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Activities
CREATE TABLE IF NOT EXISTS public.activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    track_id UUID REFERENCES public.tracks(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    activity_date TIMESTAMPTZ NOT NULL,
    chainring INTEGER,
    cog INTEGER,
    crank_length_mm NUMERIC(4, 1) DEFAULT 165.0,
    duration_sec NUMERIC(8, 2),
    distance_m NUMERIC(8, 2),
    max_cadence_rpm INTEGER,
    max_speed_kmh NUMERIC(5, 2),
    max_power_w INTEGER,
    peak_torque_nm NUMERIC(5, 1),
    fit_file_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Curves (JSONB)
CREATE TABLE IF NOT EXISTS public.activity_curves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
    curve_type TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_activities_user ON public.activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_track ON public.activities(track_id);
CREATE INDEX IF NOT EXISTS idx_curves_activity ON public.activity_curves(activity_id);

-- Velodrome Data
INSERT INTO public.tracks (name, location, country_code, length_m, surface, banking_deg, elevation_m, latitude, longitude, notes)
VALUES 
('Dick Lane Velodrome', 'East Point, GA, USA', 'USA', 321.80, 'Concrete', 36.0, 310.0, 33.685176, -84.451496, 'Unique 1/5 mile track with infield tree and creek'),
('Třebešín Velodrome', 'Praha, Czechia', 'CZE', 333.33, 'Concrete', 34.0, 240.0, 50.081700, 14.484200, 'Outdoor concrete velodrome in Prague'),
('Lviv Velodrome (SKA)', 'Lviv, Ukraine', 'UKR', 250.00, 'Wood', 42.0, 315.0, 49.850800, 24.010900, 'Indoor track')
ON CONFLICT DO NOTHING;
