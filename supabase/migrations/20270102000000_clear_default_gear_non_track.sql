-- Clear the auto-defaulted 58x14 gear from non-track rides (bug: a road race showed up as a 58x14 record in
-- Gear Architect). Gear counts as used only on track rides (src/lib/rideType.js activityHasGear); older imports
-- copied the rider's default (or a hardcoded 58/14) into chainring/cog on every ride regardless of type.
--
-- Heuristic, deliberately narrow. A row is cleared only when ALL hold:
--   * ride_type IS NULL or 'road'      (not a track ride; NULL = legacy, treated as road everywhere)
--   * chainring = 58 AND cog = 14      (the known default, nothing else is touched)
--   * gears is empty                   (no per-ride gear list the user built in the gear editor)
--   * gear_set_by IS NULL              (the guard trigger stamps this whenever a user/coach edits gear, so NULL
--                                       means nobody ever set it explicitly)
--   * track_id IS NULL                 (a ride at a velodrome may be a pre-ride-type track ride; keep it)
-- Risk: a legacy track ride with no velodrome whose owner typed 58x14 at upload (before gear stamps existed) and
-- never edited it loses that gear; the rider can set it again. Such a ride already hid its gear in the activity
-- detail. Rows the user set on track rides are never touched. Idempotent: re-running matches nothing.

UPDATE public.activities
SET chainring = NULL,
    cog = NULL
WHERE (ride_type IS NULL OR ride_type = 'road')
  AND chainring = 58
  AND cog = 14
  AND gears = '[]'::jsonb
  AND gear_set_by IS NULL
  AND track_id IS NULL;
