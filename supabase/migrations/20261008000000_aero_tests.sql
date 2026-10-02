-- VelocityStack: Aero Lab (issue #50, partial)
--
-- Migrated from v1's pages/50_aero_lab.py, which stored field-test CdA (Chung Method) results in
-- a Google Sheet worksheet ("AeroTests") keyed by a free-text UserID, with columns UserID, Date,
-- PositionName, Track, CdA, Speed_kmh, Power_W, Bike, Helmet, Handlebars, Notes. v2 has real auth
-- + a `tracks` table, so records are scoped to auth.users via RLS and the track is an optional FK
-- (nullable + a denormalized name snapshot), mirroring PB Vault's (#53) `personal_bests` table.
CREATE TABLE IF NOT EXISTS public.aero_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    track_id UUID REFERENCES public.tracks(id) ON DELETE SET NULL,
    -- Snapshot of the track's display name at save time, so history still reads correctly even
    -- if the track is later renamed or removed (same approach as personal_bests.track_name).
    track_name TEXT,
    test_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    position_name TEXT NOT NULL,
    cda NUMERIC(6, 4) NOT NULL CHECK (cda >= 0),
    speed_kmh NUMERIC(5, 1) NOT NULL CHECK (speed_kmh > 0),
    power_w NUMERIC(6, 1) NOT NULL CHECK (power_w > 0),
    bike TEXT,
    helmet TEXT,
    handlebars TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aero_tests_user ON public.aero_tests(user_id);
CREATE INDEX IF NOT EXISTS idx_aero_tests_track ON public.aero_tests(track_id);

ALTER TABLE public.aero_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own aero tests"
    ON public.aero_tests FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own aero tests"
    ON public.aero_tests FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own aero tests"
    ON public.aero_tests FOR DELETE
    USING (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE ON public.aero_tests TO authenticated;
