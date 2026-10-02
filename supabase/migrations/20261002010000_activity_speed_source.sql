-- Issue #12 follow-up: track speed provenance so the UI can be transparent when speed/distance/
-- moving time were derived from cadence + gear ratio instead of a real speed sensor.
--
-- Track bikes are fixed-gear and often have no GPS/wheel speed sensor; .fit files from those
-- devices report a "speed" field of 0.0 for every record. api/analyze.py and
-- src/app/api/sync/intervals/route.js now detect this and derive speed from cadence + the
-- chainring/cog ratio (see gear_development_m / gearDevelopmentM), tagging the result so it can
-- be surfaced to the athlete instead of silently presented as sensor-accurate.

ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS speed_source TEXT;
