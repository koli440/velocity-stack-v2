-- Issue #12 follow-up: track speed provenance so the UI can be transparent about how
-- speed/distance/moving time were computed for a given activity.
--
-- Not every ride has a real speed sensor. Track bikes are fixed-gear and often have no GPS/wheel
-- speed sensor at all; road rides commonly have GPS but no wheel sensor, and freewheel a lot
-- (so cadence alone cannot be used to infer speed). api/analyze.py and
-- src/app/api/sync/intervals/route.js pick, in order: a real recorded speed signal ('sensor'),
-- GPS-derived speed/distance ('gps'), cadence + gear-ratio derived speed for fixed-gear bikes
-- with neither of the above ('derived_from_cadence'), or otherwise leave speed/distance/moving
-- time unset rather than guess ('unavailable').

ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS speed_source TEXT;
