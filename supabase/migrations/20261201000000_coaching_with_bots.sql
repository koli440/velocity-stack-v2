-- VelocityStack: coaching with bot riders (testing aid for coaching steps 2/3)
--
-- Bots have no one to answer requests, so the SECURITY DEFINER request paths answer for them:
--   * invite_athlete(bot)  : a real user invites a bot as athlete  -> the bot (the rider) accepts.
--   * request_coach(bot)   : a real user asks a bot to coach them  -> the bot (the coach) accepts.
-- Everything else is unchanged: blocks look like "Rider not found", self-coaching is refused,
-- a rider has one active coach (an invite to a bot that already has a coach replaces it and the
-- replaced coach is notified, exactly like accept_coaching), request_coach is still refused while
-- the rider already has a coach.
-- Bots can never INITIATE anything (no session/JWT exists for them) and there is no new
-- client-callable privilege: the shared accept logic is an internal function.
--
-- bots_coach_edit() lets a bot coach change an athlete's physiology through the normal
-- triggers (stamp, audit, notification). It is executable by service_role / migrations only.

-- 1. Shared accept logic (internal; actor = the party that accepts) ------------------------
CREATE OR REPLACE FUNCTION public.coaching_accept_as(p_id UUID, p_actor UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_rider UUID;
    r public.coaching_relationships;
    v_old public.coaching_relationships;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    SELECT rider_id INTO v_rider FROM public.coaching_relationships WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such coaching request';
    END IF;
    -- Serialise per rider so concurrent accepts cannot both succeed.
    PERFORM pg_advisory_xact_lock(hashtext('coaching:' || v_rider::text));

    SELECT * INTO r FROM public.coaching_relationships WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR r.status <> 'pending' OR r.initiated_by = p_actor
       OR p_actor NOT IN (r.coach_id, r.rider_id) THEN
        RAISE EXCEPTION 'No such coaching request';
    END IF;
    IF public.is_blocked_between(r.coach_id, r.rider_id) THEN
        UPDATE public.coaching_relationships
            SET status = 'ended', ended_at = NOW(), ended_by = p_actor WHERE id = r.id;
        RAISE EXCEPTION 'No such coaching request';
    END IF;

    SELECT * INTO v_old FROM public.coaching_relationships
        WHERE rider_id = r.rider_id AND status = 'active' FOR UPDATE;
    IF FOUND THEN
        -- The coach accepting a rider's request must not replace a coach the rider has
        -- since accepted; only the rider's own accept replaces.
        IF p_actor <> r.rider_id THEN
            RAISE EXCEPTION 'This rider already has a coach';
        END IF;
        UPDATE public.coaching_relationships
            SET status = 'ended', ended_at = NOW(), ended_by = p_actor WHERE id = v_old.id;
        INSERT INTO public.notifications (user_id, actor_id, type)
            VALUES (v_old.coach_id, p_actor, 'coach_replaced');
    END IF;

    UPDATE public.coaching_relationships
        SET status = 'active', responded_at = NOW() WHERE id = r.id;
    INSERT INTO public.notifications (user_id, actor_id, type)
        VALUES (r.initiated_by, p_actor, 'coach_accepted');
END;
$$;
REVOKE ALL ON FUNCTION public.coaching_accept_as(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_coaching(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.coaching_accept_as(p_id, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.accept_coaching(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_coaching(UUID) TO authenticated;

-- 2. Request creation: bots are allowed and auto-accept ------------------------------------
CREATE OR REPLACE FUNCTION public.create_coaching_request(p_coach UUID, p_rider UUID, p_initiator UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_other UUID := CASE WHEN p_initiator = p_coach THEN p_rider ELSE p_coach END;
    v_id UUID;
BEGIN
    IF p_initiator IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF p_coach IS NULL OR p_rider IS NULL OR p_coach = p_rider THEN
        RAISE EXCEPTION 'You cannot coach yourself';
    END IF;
    -- Bots never start a relationship themselves.
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_initiator AND is_bot) THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    -- A block (either direction) looks exactly like a missing rider.
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_other)
       OR public.is_blocked_between(p_coach, p_rider) THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.coaching_relationships
        WHERE coach_id = p_coach AND rider_id = p_rider AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'You already have a coaching relationship with this rider';
    END IF;
    -- A declined request still counts as pending for 30 days so a decline stays silent and
    -- cannot be bypassed by re-sending.
    IF EXISTS (
        SELECT 1 FROM public.coaching_relationships
        WHERE coach_id = p_coach AND rider_id = p_rider
          AND (status = 'pending' OR (status = 'declined' AND responded_at > NOW() - INTERVAL '30 days'))
    ) THEN
        RAISE EXCEPTION 'A coaching request is already pending with this rider';
    END IF;
    IF (SELECT count(*) FROM public.coaching_relationships
        WHERE initiated_by = p_initiator AND status = 'pending') >= 25 THEN
        RAISE EXCEPTION 'Too many pending coaching requests';
    END IF;

    BEGIN
        INSERT INTO public.coaching_relationships (coach_id, rider_id, initiated_by)
            VALUES (p_coach, p_rider, p_initiator)
            RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'A coaching request is already pending with this rider';
    END;

    -- The bot answers immediately (same atomic accept as a human, incl. replacing the rider's
    -- current coach when a bot athlete is invited).
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_other AND is_bot) THEN
        PERFORM public.coaching_accept_as(v_id, v_other);
    END IF;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_coaching_request(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- 3. SQL-only helper: a bot coach edits an athlete's data ----------------------------------
-- Runs the normal write paths as the bot (auth.uid() is set to the bot for this transaction
-- only), so history rows get 'set by coach' stamps, coach_edits rows are written and the rider
-- gets the coach_edited notification. Refuses unless p_bot is a bot that actively coaches p_rider.
--   select public.bots_coach_edit('<bot id>', '<your id>', p_ftp_w => 310, p_weight_kg => 72.5);
CREATE OR REPLACE FUNCTION public.bots_coach_edit(
    p_bot UUID,
    p_rider UUID,
    p_ftp_w INTEGER DEFAULT NULL,
    p_weight_kg NUMERIC DEFAULT NULL,
    p_lt1_power_w INTEGER DEFAULT NULL,
    p_lt2_power_w INTEGER DEFAULT NULL,
    p_effective_from DATE DEFAULT CURRENT_DATE,
    p_profile JSONB DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_prev_sub TEXT := current_setting('request.jwt.claim.sub', true);
    v_prev_claims TEXT := current_setting('request.jwt.claims', true);
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_bot AND is_bot) THEN
        RAISE EXCEPTION 'Not a bot';
    END IF;
    IF p_rider IS NULL OR p_rider = p_bot OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_rider) THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;

    PERFORM set_config('request.jwt.claim.sub', p_bot::text, true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_bot, 'role', 'authenticated')::text, true);

    IF NOT public.is_coach_of(p_rider) THEN
        RAISE EXCEPTION 'This bot does not coach this rider';
    END IF;

    IF p_ftp_w IS NOT NULL THEN
        INSERT INTO public.ftp_history (user_id, effective_from, ftp_w)
            VALUES (p_rider, p_effective_from, p_ftp_w)
            ON CONFLICT (user_id, effective_from) DO UPDATE SET ftp_w = EXCLUDED.ftp_w;
    END IF;
    IF p_weight_kg IS NOT NULL THEN
        INSERT INTO public.weight_history (user_id, effective_from, weight_kg)
            VALUES (p_rider, p_effective_from, p_weight_kg)
            ON CONFLICT (user_id, effective_from) DO UPDATE SET weight_kg = EXCLUDED.weight_kg;
    END IF;
    IF p_lt1_power_w IS NOT NULL OR p_lt2_power_w IS NOT NULL THEN
        INSERT INTO public.lactate_threshold_history (user_id, effective_from, lt1_power_w, lt2_power_w)
            VALUES (p_rider, p_effective_from, p_lt1_power_w, p_lt2_power_w)
            ON CONFLICT (user_id, effective_from) DO UPDATE
               SET lt1_power_w = COALESCE(EXCLUDED.lt1_power_w, lactate_threshold_history.lt1_power_w),
                   lt2_power_w = COALESCE(EXCLUDED.lt2_power_w, lactate_threshold_history.lt2_power_w);
    END IF;
    IF p_profile IS NOT NULL THEN
        PERFORM public.coach_update_athlete_profile(p_rider, p_profile);
    END IF;

    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
    PERFORM set_config('request.jwt.claims', COALESCE(v_prev_claims, ''), true);
END;
$$;

REVOKE ALL ON FUNCTION public.bots_coach_edit(UUID, UUID, INTEGER, NUMERIC, INTEGER, INTEGER, DATE, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bots_coach_edit(UUID, UUID, INTEGER, NUMERIC, INTEGER, INTEGER, DATE, JSONB)
    TO service_role;
