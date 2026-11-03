-- Planned workouts get a 'run' discipline (run activities link only to run workouts; enforced client-side
-- like the other discipline rules). Idempotent.
ALTER TABLE public.planned_workouts DROP CONSTRAINT IF EXISTS planned_workouts_discipline;
ALTER TABLE public.planned_workouts
    ADD CONSTRAINT planned_workouts_discipline CHECK (discipline IN ('ride', 'track', 'gym', 'run', 'other'));
