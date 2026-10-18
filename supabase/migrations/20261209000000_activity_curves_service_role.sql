-- Background Strava/Intervals.icu sync and the Strava repair path write activity_curves with the
-- service-role client. Make that privilege explicit (idempotent, additive); RLS for clients is unchanged.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_curves TO service_role;
