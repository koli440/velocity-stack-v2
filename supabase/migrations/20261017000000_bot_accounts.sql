-- VelocityStack: synthetic bot riders (issue #80)
--
-- Bots are normal auth users + profiles flagged is_bot. They are created and fed by
-- scripts/bots (service role), and labelled with a "bot" badge everywhere they appear.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS bot_persona TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_is_bot ON public.profiles(id) WHERE is_bot;

-- Same view as 20261014 plus is_bot (appended, so existing consumers are unaffected).
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles AS
    SELECT
        p.id,
        COALESCE(NULLIF(p.nickname, ''), NULLIF(p.first_name, '')) AS username,
        NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '') AS full_name,
        NULL::text AS avatar_url,
        p.require_follow_approval,
        p.is_bot
    FROM public.profiles p
    WHERE NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE b.blocker_id = p.id AND b.blocked_id = auth.uid()
    );

GRANT SELECT ON public.public_profiles TO authenticated;

-- Only the service role may set bot flags (column REVOKEs don't override table-level grants).
CREATE OR REPLACE FUNCTION public.protect_bot_flags()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE(auth.role(), 'service_role') = 'service_role' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.is_bot := FALSE;
        NEW.bot_persona := NULL;
    ELSE
        NEW.is_bot := OLD.is_bot;
        NEW.bot_persona := OLD.bot_persona;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_bot_flags ON public.profiles;
CREATE TRIGGER trg_protect_bot_flags
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.protect_bot_flags();
