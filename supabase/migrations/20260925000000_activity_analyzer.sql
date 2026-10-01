-- VelocityStack: Next-gen activity analyzer (Phase 1 & 2)
-- Phase 1: Permanent raw .fit storage + baseline telemetry extraction
-- Phase 2: Declarative evaluation templates + apples-to-apples benchmarking

-- 0. Processing status enum for the two-phase pipeline
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_processing_status') THEN
        CREATE TYPE public.activity_processing_status AS ENUM (
            'pending',
            'baseline_completed',
            'template_applied',
            'failed'
        );
    END IF;
END$$;

-- 1. Extend activities with Phase 1 raw-storage + baseline fields
ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS raw_file_url TEXT,
    ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS processing_status public.activity_processing_status NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS time_series JSONB,
    ADD COLUMN IF NOT EXISTS curves_data JSONB,
    -- Wizard / segmentation metadata that the app already relies on
    ADD COLUMN IF NOT EXISTS sport_type TEXT,
    ADD COLUMN IF NOT EXISTS session_mode TEXT,
    ADD COLUMN IF NOT EXISTS discipline TEXT,
    ADD COLUMN IF NOT EXISTS bike_model TEXT,
    ADD COLUMN IF NOT EXISTS handlebar_setup TEXT,
    ADD COLUMN IF NOT EXISTS helmet TEXT,
    ADD COLUMN IF NOT EXISTS perceived_exertion SMALLINT,
    ADD COLUMN IF NOT EXISTS segmentation_mode TEXT,
    ADD COLUMN IF NOT EXISTS detected_efforts JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS wizard_completed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS moving_time_s NUMERIC(8, 2);

-- Avoid a unique constraint so the same raw file can be re-synced/re-processed,
-- but index it for fast de-dupe lookups.
CREATE INDEX IF NOT EXISTS idx_activities_file_sha256 ON public.activities(file_sha256);
CREATE INDEX IF NOT EXISTS idx_activities_processing_status ON public.activities(processing_status);

-- 2. Declarative evaluation templates (Phase 2 manifests)
CREATE TABLE IF NOT EXISTS public.analysis_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'track', -- track | road | gym
    manifest JSONB NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Per-activity template evaluation results (effort metrics, benchmarking)
CREATE TABLE IF NOT EXISTS public.template_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES public.analysis_templates(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    efforts JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_executions_activity ON public.template_executions(activity_id);
CREATE INDEX IF NOT EXISTS idx_template_executions_template ON public.template_executions(template_id);
CREATE INDEX IF NOT EXISTS idx_template_executions_user ON public.template_executions(user_id);

-- 4. Storage bucket for immutable raw .fit archives
INSERT INTO storage.buckets (id, name, public)
VALUES ('raw-activity-files', 'raw-activity-files', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Users may read/write only within their own user_id-prefixed folder
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = 'Users manage own raw activity files'
    ) THEN
        CREATE POLICY "Users manage own raw activity files"
        ON storage.objects FOR ALL
        USING (bucket_id = 'raw-activity-files' AND auth.uid()::text = (storage.foldername(name))[1])
        WITH CHECK (bucket_id = 'raw-activity-files' AND auth.uid()::text = (storage.foldername(name))[1]);
    END IF;
END$$;

-- 5. Seed default analysis templates
INSERT INTO public.analysis_templates (slug, name, description, category, manifest)
VALUES
(
    'tpl_vo2max_3min',
    'VO2max 3x3 Minute Intervals',
    '3x 3-minute high intensity intervals with drop-off % between repeats and HR recovery after each effort.',
    'road',
    '{
        "pattern": "repeated_bursts",
        "target_count": 3,
        "target_duration_sec": 180,
        "duration_tolerance_sec": 45,
        "metrics": ["avg_power", "dropoff_pct", "pacing_index", "hr_recovery_60s"],
        "recovery_window_sec": 60
    }'::jsonb
),
(
    'tpl_track_f200',
    'F200m Flying Sprint',
    'Flying 200m sprint on the velodrome: peak cadence/power window and estimated 200m time.',
    'track',
    '{
        "pattern": "flying_sprint",
        "distance_m": 200,
        "metrics": ["max_cadence", "max_power", "estimated_time", "pacing_index"]
    }'::jsonb
),
(
    'tpl_track_pursuit',
    'Individual Pursuit (2/3/4km)',
    'Sustained time-trial effort with 250m lap splits, pacing index and fade analysis.',
    'track',
    '{
        "pattern": "sustained_tt",
        "distances_m": [2000, 3000, 4000],
        "lap_length_m": 250,
        "metrics": ["avg_power", "lap_splits_250m", "pacing_index", "dropoff_pct"]
    }'::jsonb
),
(
    'tpl_track_standing_start',
    'Standing Start / Kilo',
    'Standing start effort (500m / Kilo) with peak torque and time-to-peak-power.',
    'track',
    '{
        "pattern": "standing_start",
        "distance_m": 1000,
        "metrics": ["peak_torque", "time_to_peak_power_sec", "max_power", "avg_power_first_10s"]
    }'::jsonb
),
(
    'tpl_road_z2_decoupling',
    'Aerobic Decoupling (Pw:HR)',
    'Steady Z2 endurance effort split into two halves to compute power:heart-rate decoupling %.',
    'road',
    '{
        "pattern": "sustained_tt",
        "min_duration_sec": 1200,
        "metrics": ["pw_hr_decoupling_pct", "avg_power", "avg_heartrate"]
    }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;
