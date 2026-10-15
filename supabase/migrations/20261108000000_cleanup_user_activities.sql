-- One-off cleanup: delete all activities owned by koli440@gmail.com.
-- Dependents (activity_curves, analyzer results, photos) cascade via FK.
-- Idempotent: re-running deletes nothing once the rows are gone.
DELETE FROM public.activities
WHERE user_id IN (
    SELECT id FROM auth.users WHERE lower(email) = 'koli440@gmail.com'
);
