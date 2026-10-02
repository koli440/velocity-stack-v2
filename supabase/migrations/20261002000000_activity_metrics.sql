-- Issue #11: Full activity-level metrics
-- Adds the remaining metric columns requested on the Activity model (start time, elapsed/moving
-- time breakdown, average speed/power/cadence/torque, normalized power, elevation gain/descent,
-- intensity/training load, and HR) plus an athlete FTP field needed to derive intensity & load.

ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS elapsed_time_s NUMERIC(8, 2),
    ADD COLUMN IF NOT EXISTS avg_speed_kmh NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS avg_power_w INTEGER,
    ADD COLUMN IF NOT EXISTS normalized_power_w INTEGER,
    ADD COLUMN IF NOT EXISTS avg_hr INTEGER,
    ADD COLUMN IF NOT EXISTS max_hr INTEGER,
    ADD COLUMN IF NOT EXISTS avg_cadence_rpm INTEGER,
    ADD COLUMN IF NOT EXISTS avg_torque_nm NUMERIC(5, 1),
    ADD COLUMN IF NOT EXISTS elevation_gain_m NUMERIC(7, 1),
    ADD COLUMN IF NOT EXISTS elevation_loss_m NUMERIC(7, 1),
    -- Intensity Factor: normalized_power_w / athlete FTP at time of upload
    ADD COLUMN IF NOT EXISTS intensity_factor NUMERIC(4, 3),
    -- Training load (TSS-style): (elapsed_time_s * normalized_power_w * intensity_factor) / (ftp_w * 3600) * 100
    ADD COLUMN IF NOT EXISTS training_load NUMERIC(6, 1);

-- Athlete threshold power, required to compute intensity_factor / training_load above.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS ftp_w INTEGER;
