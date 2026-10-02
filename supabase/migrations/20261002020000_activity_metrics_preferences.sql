-- issue #17: allow users to hide/unhide activity metrics on the Activity detail page.
--
-- The app already stores per-user preferences directly on public.profiles
-- (theme_preference, ftp_w, default_chainring, ...), so we keep that single
-- location instead of introducing a separate user_preferences table.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS hidden_activity_metrics JSONB NOT NULL DEFAULT '[]'::jsonb;
