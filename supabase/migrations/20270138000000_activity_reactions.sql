-- VelocityStack: activity reactions ("Respect", a lightweight +1). Additive and idempotent.
--
-- * One reaction type today ('respect'); activity_reactions.type is a CHECK list so more can be added later
--   without a schema change. Unique (activity_id, user_id, type): tapping toggles, repeats are no-ops.
-- * Who may react = who can SEE the activity (user_can_view_activity, same helper as comments: public,
--   followers, active coach, blocks win). Never your own activity; bots cannot react.
-- * Writes only through SECURITY DEFINER RPCs (clients have no table privileges); rate limit 60/hour and
--   300/day per rider (activity_reaction_log, survives un-reacting).
-- * Reads: activity_reaction_info(ids) gives counts for activities the viewer can see (coach-safe: hidden or
--   private activities are simply absent); activity_reactors(activity) names the reactors to the OWNER only.
-- * Notifications: type 'activity_reaction' to the owner, coalesced: one unread per (owner, activity) whose
--   event_count grows ("X and 3 others"), at most once per reactor per activity ever (activity_reaction_notified),
--   so un/re-toggling never re-notifies. Push and email follow the existing notification rules.
-- * Owner settings on profiles: reactions_enabled (accept reactions) and reaction_notifications (be notified).

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS reactions_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS reaction_notifications BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS event_count INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'new_follower', 'follow_request', 'follow_approved',
        'suggestion_submitted', 'suggestion_approved', 'suggestion_rejected',
        'coach_invite', 'coach_request', 'coach_accepted', 'coach_ended', 'coach_replaced',
        'coach_edited',
        'activity_comment', 'comment_mention',
        'activity_reaction'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_activity_reaction_unread
    ON public.notifications (user_id, activity_id)
    WHERE type = 'activity_reaction' AND read_at IS NULL;

CREATE TABLE IF NOT EXISTS public.activity_reactions (
    activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'respect' CHECK (type IN ('respect')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (activity_id, user_id, type)
);
CREATE INDEX IF NOT EXISTS idx_activity_reactions_user ON public.activity_reactions (user_id);

-- Rate-limit ledger.
CREATE TABLE IF NOT EXISTS public.activity_reaction_log (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_reaction_log_user
    ON public.activity_reaction_log (user_id, created_at DESC);

-- "Already notified" ledger: a reactor notifies the owner at most once per activity and type.
CREATE TABLE IF NOT EXISTS public.activity_reaction_notified (
    activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (activity_id, user_id, type)
);

ALTER TABLE public.activity_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_reaction_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_reaction_notified ENABLE ROW LEVEL SECURITY;

-- No client access at all: everything goes through the RPCs below (no policies = deny).
REVOKE ALL ON public.activity_reactions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.activity_reaction_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.activity_reaction_notified FROM PUBLIC, anon, authenticated;

-- Toggles the caller's reaction. Returns the new visible count.
CREATE OR REPLACE FUNCTION public.set_activity_reaction(
    p_activity UUID, p_on BOOLEAN DEFAULT TRUE, p_type TEXT DEFAULT 'respect'
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_owner UUID;
    v_inserted INTEGER;
    v_first BOOLEAN;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF p_type IS NULL OR p_type NOT IN ('respect') THEN
        RAISE EXCEPTION 'Unknown reaction';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_me AND is_bot) THEN
        RAISE EXCEPTION 'Not available for this account';
    END IF;
    -- Hidden or missing activities look identical.
    IF NOT public.user_can_view_activity(v_me, p_activity) THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;
    SELECT user_id INTO v_owner FROM public.activities WHERE id = p_activity;
    IF v_owner = v_me THEN
        RAISE EXCEPTION 'You cannot react to your own activity';
    END IF;

    IF NOT COALESCE(p_on, TRUE) THEN
        DELETE FROM public.activity_reactions
            WHERE activity_id = p_activity AND user_id = v_me AND type = p_type;
    ELSE
        IF NOT COALESCE((SELECT reactions_enabled FROM public.profiles WHERE id = v_owner), TRUE) THEN
            RAISE EXCEPTION 'Reactions are turned off for this activity';
        END IF;
        -- Serialise per rider so concurrent taps cannot slip past the limit.
        PERFORM pg_advisory_xact_lock(hashtextextended('activity_reaction:' || v_me::text, 0));
        IF NOT EXISTS (
            SELECT 1 FROM public.activity_reactions
            WHERE activity_id = p_activity AND user_id = v_me AND type = p_type
        ) THEN
            IF (SELECT count(*) FROM public.activity_reaction_log
                  WHERE user_id = v_me AND created_at > NOW() - INTERVAL '1 hour') >= 60
               OR (SELECT count(*) FROM public.activity_reaction_log
                  WHERE user_id = v_me AND created_at > NOW() - INTERVAL '1 day') >= 300 THEN
                RAISE EXCEPTION 'limit reached';
            END IF;
            INSERT INTO public.activity_reactions (activity_id, user_id, type)
                VALUES (p_activity, v_me, p_type)
                ON CONFLICT DO NOTHING;
            GET DIAGNOSTICS v_inserted = ROW_COUNT;
            IF v_inserted > 0 THEN
                INSERT INTO public.activity_reaction_log (user_id) VALUES (v_me);
                INSERT INTO public.activity_reaction_notified (activity_id, user_id, type)
                    VALUES (p_activity, v_me, p_type)
                    ON CONFLICT DO NOTHING;
                GET DIAGNOSTICS v_inserted = ROW_COUNT;
                v_first := v_inserted > 0;
                IF v_first
                   AND COALESCE((SELECT reaction_notifications FROM public.profiles WHERE id = v_owner), TRUE)
                   AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_owner AND is_bot)
                   AND NOT public.is_blocked_between(v_owner, v_me) THEN
                    INSERT INTO public.notifications (user_id, actor_id, type, activity_id)
                        VALUES (v_owner, v_me, 'activity_reaction', p_activity)
                        ON CONFLICT (user_id, activity_id)
                            WHERE type = 'activity_reaction' AND read_at IS NULL
                        DO UPDATE SET actor_id = EXCLUDED.actor_id,
                                      event_count = public.notifications.event_count + 1,
                                      created_at = NOW();
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN (SELECT count(*)::int FROM public.activity_reactions r
            WHERE r.activity_id = p_activity AND r.type = p_type
              AND NOT public.is_blocked_between(v_me, r.user_id));
END;
$$;

-- Counts for the activities the viewer can see. can_react: not own, not a bot, owner accepts reactions.
CREATE OR REPLACE FUNCTION public.activity_reaction_info(p_ids UUID[], p_type TEXT DEFAULT 'respect')
RETURNS TABLE (
    activity_id UUID,
    owner_id UUID,
    reaction_count INTEGER,
    i_reacted BOOLEAN,
    can_react BOOLEAN,
    is_owner BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT a.id,
           a.user_id,
           (SELECT count(*)::int FROM public.activity_reactions r
             WHERE r.activity_id = a.id AND r.type = p_type
               AND NOT public.is_blocked_between(auth.uid(), r.user_id)),
           EXISTS (SELECT 1 FROM public.activity_reactions r
                    WHERE r.activity_id = a.id AND r.user_id = auth.uid() AND r.type = p_type),
           a.user_id <> auth.uid()
             AND NOT EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.is_bot)
             AND COALESCE((SELECT o.reactions_enabled FROM public.profiles o WHERE o.id = a.user_id), TRUE),
           a.user_id = auth.uid()
    FROM public.activities a
    WHERE a.id = ANY (p_ids[1:100])
      AND p_type = 'respect'
      AND public.user_can_view_activity(auth.uid(), a.id)
$$;

-- Who reacted, for the activity owner only.
CREATE OR REPLACE FUNCTION public.activity_reactors(p_activity UUID, p_type TEXT DEFAULT 'respect')
RETURNS TABLE (user_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.activities a WHERE a.id = p_activity AND a.user_id = auth.uid()
    ) THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT r.user_id, r.created_at
    FROM public.activity_reactions r
    WHERE r.activity_id = p_activity AND r.type = p_type
      AND NOT public.is_blocked_between(auth.uid(), r.user_id)
    ORDER BY r.created_at DESC
    LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.set_activity_reaction(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.activity_reaction_info(UUID[], TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.activity_reactors(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_activity_reaction(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activity_reaction_info(UUID[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activity_reactors(UUID, TEXT) TO authenticated;
