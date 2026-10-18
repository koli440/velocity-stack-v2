-- Point pg_net callbacks (cron jobs, Strava webhook callback) at the canonical production host.
-- Only overwrites a missing row or the old seeded default; deliberate changes are kept.
INSERT INTO public.sync_settings (key, value)
VALUES ('app_base_url', 'https://www.velocity-stack.app')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now()
WHERE public.sync_settings.value IS NULL
   OR btrim(public.sync_settings.value) = ''
   OR public.sync_settings.value = 'https://velocity-stack-v2.vercel.app';
