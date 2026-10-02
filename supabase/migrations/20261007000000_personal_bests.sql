-- VelocityStack: PB Vault (issue #50, partial)
--
-- Migrated from v1's pages/30_PB_vault.py + pages/31_PB_detail.py, which stored
-- Personal Best records in a Google Sheet worksheet ("PBs") keyed by a free-text
-- UserID. v2 has real auth + a `tracks` table, so records are scoped to
-- auth.users via RLS and the track is an optional FK (nullable so a PB can
-- still be logged for a track that isn't in our `tracks` catalogue - v1 let
-- riders free-pick any track from their sheet). Discipline stays a fixed
-- reference list on the client (src/lib/pbVault.js), mirroring how
-- Pursuit Strategist (#52) keeps UCI track disciplines out of the DB.
CREATE TABLE IF NOT EXISTS public.personal_bests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    track_id UUID REFERENCES public.tracks(id) ON DELETE SET NULL,
    -- Snapshot of the track's display name at save time, so history still
    -- reads correctly even if the track is later renamed or removed.
    track_name TEXT,
    discipline TEXT NOT NULL,
    discipline_distance_m INTEGER NOT NULL CHECK (discipline_distance_m > 0),
    event_name TEXT,
    achieved_date DATE NOT NULL DEFAULT CURRENT_DATE,
    time_seconds NUMERIC(10, 3) NOT NULL CHECK (time_seconds > 0),
    avg_speed_kmh NUMERIC(6, 2),
    chainring INTEGER,
    cog INTEGER,
    -- Optional lap/split breakdown (v1's Lap_Times/Split_Mode/Split_Distance).
    split_mode TEXT NOT NULL DEFAULT 'laps' CHECK (split_mode IN ('laps', 'distance')),
    split_distance_m NUMERIC(7, 2),
    lap_times NUMERIC(8, 3)[] NOT NULL DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_bests_user ON public.personal_bests(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_bests_track ON public.personal_bests(track_id);

ALTER TABLE public.personal_bests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own personal bests"
    ON public.personal_bests FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own personal bests"
    ON public.personal_bests FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own personal bests"
    ON public.personal_bests FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own personal bests"
    ON public.personal_bests FOR DELETE
    USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_bests TO authenticated;
