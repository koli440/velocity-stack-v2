-- Coach module, phase 1a: feature flag `coach_module` (default OFF) and coach notes.
--
-- Flag
--  * coach_module_settings (single row, global_enabled default FALSE) + coach_module_allowlist (per account).
--  * coach_module_enabled(user) = global OR allow-listed. Every coach-module RPC checks it server side;
--    the UI only mirrors it through my_coach_module_enabled(). Managed by admins only
--    (admin_coach_module_status / admin_set_coach_module_global / admin_coach_module_allow).
--  * Clients have no table privileges on either table.
--
-- Coach notes
--  * Private notes of a coach about an athlete. Written only by RPC and only while is_coach_of(rider).
--  * The coach reads them while coaching is active and during a 30-day window after it ended (export);
--    a daily pg_cron job (SQL only) then deletes them. Notes the coach shared with the rider stay as the
--    rider's read-only copy (the rider may hide it).
--  * author/stamps come from auth.uid(), never from the client. No client INSERT/UPDATE/DELETE and no
--    client SELECT: all access goes through SECURITY DEFINER RPCs.
--  * Sharing a note creates one UNREAD 'coach_note_shared' notification per coach/rider (later ones bump it).
-- All objects are additive and idempotent.

-- 1. Flag ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coach_module_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    global_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.coach_module_settings (id, global_enabled) VALUES (TRUE, FALSE) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.coach_module_allowlist (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.coach_module_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_module_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_module_settings, public.coach_module_allowlist FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coach_module_enabled(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((SELECT global_enabled FROM public.coach_module_settings WHERE id), FALSE)
        OR (p_user IS NOT NULL AND EXISTS (SELECT 1 FROM public.coach_module_allowlist WHERE user_id = p_user))
$$;
REVOKE ALL ON FUNCTION public.coach_module_enabled(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coach_module_require()
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT public.coach_module_enabled(auth.uid()) THEN
        RAISE EXCEPTION 'Coach module is not enabled';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.coach_module_require() FROM PUBLIC, anon, authenticated;

-- UI mirror of the flag for the signed-in user.
CREATE OR REPLACE FUNCTION public.my_coach_module_enabled()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT auth.uid() IS NOT NULL AND public.coach_module_enabled(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.my_coach_module_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_coach_module_enabled() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_coach_module_status()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin only';
    END IF;
    RETURN jsonb_build_object(
        'global_enabled', COALESCE((SELECT global_enabled FROM public.coach_module_settings WHERE id), FALSE),
        'allowlist', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('user_id', a.user_id, 'display_name', public.profile_display_name(p.nickname, p.first_name, p.last_name), 'added_at', a.added_at)
                             ORDER BY a.added_at)
            FROM public.coach_module_allowlist a LEFT JOIN public.profiles p ON p.id = a.user_id), '[]'::jsonb)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_coach_module_global(p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin only';
    END IF;
    UPDATE public.coach_module_settings SET global_enabled = COALESCE(p_enabled, FALSE), updated_at = NOW() WHERE id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_coach_module_allow(p_user UUID, p_allowed BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin only';
    END IF;
    IF p_allowed THEN
        IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user) THEN
            RAISE EXCEPTION 'No such user';
        END IF;
        INSERT INTO public.coach_module_allowlist (user_id, added_by) VALUES (p_user, auth.uid())
            ON CONFLICT (user_id) DO NOTHING;
    ELSE
        DELETE FROM public.coach_module_allowlist WHERE user_id = p_user;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_coach_module_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_coach_module_global(BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_coach_module_allow(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_coach_module_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_coach_module_global(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_coach_module_allow(UUID, BOOLEAN) TO authenticated;

-- 2. Notification types for the whole coach module (one constraint rewrite, phases 1-4) -------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'new_follower', 'follow_request', 'follow_approved',
        'suggestion_submitted', 'suggestion_approved', 'suggestion_rejected',
        'coach_invite', 'coach_request', 'coach_accepted', 'coach_ended', 'coach_replaced',
        'coach_edited',
        'activity_comment', 'comment_mention',
        'activity_reaction',
        'onboarding_submitted', 'coach_note_shared', 'coach_message',
        'licence_reviewed', 'licence_expiring',
        'payment_failed', 'subscription_started', 'subscription_ended'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_coach_note_shared_unread
    ON public.notifications (user_id, actor_id)
    WHERE type = 'coach_note_shared' AND read_at IS NULL;

-- 3. coach_notes ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coach_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    note_date DATE NOT NULL DEFAULT CURRENT_DATE,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    shared_with_rider BOOLEAN NOT NULL DEFAULT FALSE,
    -- Set by the rider to hide their copy of a shared note.
    rider_hidden_at TIMESTAMPTZ,
    activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
    planned_workout_id UUID REFERENCES public.planned_workouts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (coach_id <> rider_id),
    CONSTRAINT coach_notes_title_len CHECK (char_length(title) <= 80),
    CONSTRAINT coach_notes_body_len CHECK (char_length(body) BETWEEN 1 AND 4000),
    CONSTRAINT coach_notes_tags_valid CHECK (tags <@ ARRAY['injury', 'goal', 'feedback', 'admin', 'other']::TEXT[]),
    CONSTRAINT coach_notes_date_range CHECK (note_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31')
);
CREATE INDEX IF NOT EXISTS idx_coach_notes_pair ON public.coach_notes (coach_id, rider_id, note_date DESC);
CREATE INDEX IF NOT EXISTS idx_coach_notes_rider ON public.coach_notes (rider_id) WHERE shared_with_rider;

ALTER TABLE public.coach_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_notes FROM PUBLIC, anon, authenticated;

-- True while the caller coaches the rider (active) or within 30 days after an accepted relationship ended.
CREATE OR REPLACE FUNCTION public.coach_notes_window(p_coach UUID, p_rider UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.coaching_relationships c
        WHERE c.coach_id = p_coach AND c.rider_id = p_rider
          AND (c.status = 'active'
               OR (c.status = 'ended' AND c.responded_at IS NOT NULL AND c.ended_at > NOW() - INTERVAL '30 days'))
    )
$$;
REVOKE ALL ON FUNCTION public.coach_notes_window(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- 4. RPCs ----------------------------------------------------------------------------------
-- p: {id?, rider_id, note_date?, title?, body, tags?, pinned?, shared_with_rider?, activity_id?, planned_workout_id?}
CREATE OR REPLACE FUNCTION public.coach_note_save(p JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_id UUID := NULLIF(p->>'id', '')::UUID;
    v_rider UUID := NULLIF(p->>'rider_id', '')::UUID;
    v_old public.coach_notes;
    v_title TEXT := btrim(COALESCE(p->>'title', ''));
    v_body TEXT := btrim(COALESCE(p->>'body', ''));
    v_tags TEXT[] := COALESCE(ARRAY(SELECT DISTINCT jsonb_array_elements_text(COALESCE(p->'tags', '[]'::JSONB))), '{}');
    v_date DATE := COALESCE(NULLIF(p->>'note_date', '')::DATE, CURRENT_DATE);
    v_pinned BOOLEAN := COALESCE((p->>'pinned')::BOOLEAN, FALSE);
    v_shared BOOLEAN := COALESCE((p->>'shared_with_rider')::BOOLEAN, FALSE);
    v_activity UUID := NULLIF(p->>'activity_id', '')::UUID;
    v_workout UUID := NULLIF(p->>'planned_workout_id', '')::UUID;
BEGIN
    PERFORM public.coach_module_require();
    IF v_id IS NOT NULL THEN
        SELECT * INTO v_old FROM public.coach_notes WHERE id = v_id AND coach_id = v_me FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'No such note';
        END IF;
        v_rider := v_old.rider_id;
    END IF;
    IF v_rider IS NULL OR NOT public.is_coach_of(v_rider) THEN
        RAISE EXCEPTION 'You are not coaching this rider';
    END IF;
    IF char_length(v_title) > 80 THEN RAISE EXCEPTION 'Title is too long'; END IF;
    IF char_length(v_body) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Note must be 1-4000 characters'; END IF;
    IF NOT (v_tags <@ ARRAY['injury', 'goal', 'feedback', 'admin', 'other']::TEXT[]) THEN
        RAISE EXCEPTION 'Unknown tag';
    END IF;
    IF v_activity IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.activities WHERE id = v_activity AND user_id = v_rider) THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;
    IF v_workout IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.planned_workouts WHERE id = v_workout AND rider_id = v_rider) THEN
        RAISE EXCEPTION 'Planned workout not found';
    END IF;

    IF v_id IS NULL THEN
        IF (SELECT count(*) FROM public.coach_notes WHERE coach_id = v_me AND rider_id = v_rider) >= 200 THEN
            RAISE EXCEPTION 'Too many notes for this athlete';
        END IF;
        IF (SELECT count(*) FROM public.coach_notes WHERE coach_id = v_me AND created_at > NOW() - INTERVAL '1 hour') >= 60 THEN
            RAISE EXCEPTION 'Too many notes, try again later';
        END IF;
        INSERT INTO public.coach_notes (coach_id, rider_id, note_date, title, body, tags, pinned, shared_with_rider,
                                        activity_id, planned_workout_id)
            VALUES (v_me, v_rider, v_date, v_title, v_body, v_tags, v_pinned, v_shared, v_activity, v_workout)
            RETURNING id INTO v_id;
        IF v_shared THEN
            PERFORM public.coach_note_notify(v_me, v_rider);
        END IF;
    ELSE
        UPDATE public.coach_notes
            SET note_date = v_date, title = v_title, body = v_body, tags = v_tags, pinned = v_pinned,
                shared_with_rider = v_shared, activity_id = v_activity, planned_workout_id = v_workout,
                rider_hidden_at = CASE WHEN v_shared THEN rider_hidden_at ELSE NULL END,
                updated_at = NOW()
            WHERE id = v_id;
        IF v_shared AND NOT v_old.shared_with_rider THEN
            PERFORM public.coach_note_notify(v_me, v_rider);
        END IF;
    END IF;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.coach_note_notify(p_coach UUID, p_rider UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF public.is_blocked_between(p_coach, p_rider) THEN
        RETURN;
    END IF;
    INSERT INTO public.notifications (user_id, actor_id, type)
        VALUES (p_rider, p_coach, 'coach_note_shared')
        ON CONFLICT (user_id, actor_id) WHERE type = 'coach_note_shared' AND read_at IS NULL
        DO UPDATE SET created_at = NOW();
END;
$$;
REVOKE ALL ON FUNCTION public.coach_note_notify(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coach_note_delete(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    n public.coach_notes;
BEGIN
    PERFORM public.coach_module_require();
    SELECT * INTO n FROM public.coach_notes WHERE id = p_id AND coach_id = v_me FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such note';
    END IF;
    -- After coaching ended a shared note stays as the rider's copy.
    IF n.shared_with_rider AND NOT public.is_coach_of(n.rider_id) THEN
        RAISE EXCEPTION 'Shared notes stay with the rider after coaching ended';
    END IF;
    DELETE FROM public.coach_notes WHERE id = p_id;
END;
$$;

-- The coach's own notes about a rider (active coaching or the 30-day export window).
CREATE OR REPLACE FUNCTION public.coach_notes_list(p_rider UUID)
RETURNS TABLE (
    id UUID, rider_id UUID, note_date DATE, title TEXT, body TEXT, tags TEXT[], pinned BOOLEAN,
    shared_with_rider BOOLEAN, activity_id UUID, planned_workout_id UUID,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, read_only BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.coach_module_require();
    IF NOT public.coach_notes_window(auth.uid(), p_rider) THEN
        RETURN;
    END IF;
    RETURN QUERY
        SELECT n.id, n.rider_id, n.note_date, n.title, n.body, n.tags, n.pinned, n.shared_with_rider,
               n.activity_id, n.planned_workout_id, n.created_at, n.updated_at,
               NOT public.is_coach_of(n.rider_id)
        FROM public.coach_notes n
        WHERE n.coach_id = auth.uid() AND n.rider_id = p_rider
        ORDER BY n.pinned DESC, n.note_date DESC, n.created_at DESC;
END;
$$;

-- Rider side: notes the coach shared (never the unshared ones, never from a blocked coach).
CREATE OR REPLACE FUNCTION public.my_shared_notes()
RETURNS TABLE (
    id UUID, coach_id UUID, coach_name TEXT, note_date DATE, title TEXT, body TEXT, tags TEXT[],
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT n.id, n.coach_id, public.profile_display_name(p.nickname, p.first_name, p.last_name), n.note_date, n.title, n.body, n.tags, n.created_at, n.updated_at
    FROM public.coach_notes n
    JOIN public.profiles p ON p.id = n.coach_id
    WHERE auth.uid() IS NOT NULL AND n.rider_id = auth.uid()
      AND n.shared_with_rider AND n.rider_hidden_at IS NULL
      AND public.coach_module_enabled(n.coach_id)
      AND NOT public.is_blocked_between(n.coach_id, n.rider_id)
    ORDER BY n.created_at DESC
$$;

CREATE OR REPLACE FUNCTION public.hide_shared_note(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    UPDATE public.coach_notes SET rider_hidden_at = NOW()
        WHERE id = p_id AND rider_id = auth.uid() AND shared_with_rider AND rider_hidden_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such note';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.coach_note_save(JSONB), public.coach_note_delete(UUID), public.coach_notes_list(UUID),
    public.my_shared_notes(), public.hide_shared_note(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_note_save(JSONB), public.coach_note_delete(UUID), public.coach_notes_list(UUID),
    public.my_shared_notes(), public.hide_shared_note(UUID) TO authenticated;

-- 5. 30-day deletion job ---------------------------------------------------------------------
-- Deletes a coach's notes about a rider once there is no active relationship and none ended within 30 days.
-- Shared notes stay as the rider's copy unless the rider hid them.
CREATE OR REPLACE FUNCTION public.coach_notes_purge()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_count INTEGER;
BEGIN
    DELETE FROM public.coach_notes n
    WHERE (NOT n.shared_with_rider OR n.rider_hidden_at IS NOT NULL)
      AND NOT public.coach_notes_window(n.coach_id, n.rider_id);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.coach_notes_purge() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'coach-notes-purge') THEN
        PERFORM cron.unschedule('coach-notes-purge');
    END IF;
    PERFORM cron.schedule('coach-notes-purge', '40 3 * * *', 'SELECT public.coach_notes_purge()');
END;
$$;
