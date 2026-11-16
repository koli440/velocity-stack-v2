-- The stored lactate step template is gone: the "New step test" form (prefilled with the default
-- steps) is the single step definition. Additive/idempotent; earlier migrations are untouched.
DROP FUNCTION IF EXISTS public.lab_lactate_plan_get(uuid);
DROP FUNCTION IF EXISTS public.lab_lactate_plan_save(uuid, text, integer, jsonb);
DROP FUNCTION IF EXISTS public.lab_lactate_plan_reset(uuid);
DROP FUNCTION IF EXISTS public.lab_lactate_plan_owner(uuid);
DROP TABLE IF EXISTS public.lab_lactate_plans;
