-- Coach module: payment starts after acceptance. The application records the chosen package; once the coach accepts
-- (both sides accepted) the athlete gets a "Pay for your plan" prompt (notification + coaching panel). Additive/idempotent.

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
        'payment_failed', 'subscription_started', 'subscription_ended',
        'lab_test_planned', 'lab_test_due', 'lab_test_result',
        'payment_requested'
    ));

ALTER TABLE public.onboarding_submissions
    ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES public.coach_packages(id) ON DELETE SET NULL;

-- The old 7-argument signature is replaced (an extra DEFAULT argument would make named-argument RPC calls ambiguous).
DROP FUNCTION IF EXISTS public.submit_onboarding(TEXT, JSONB, JSONB, BOOLEAN, JSONB, INTEGER, TEXT);
CREATE OR REPLACE FUNCTION public.submit_onboarding(
    p_slug TEXT, p_answers JSONB, p_health JSONB, p_health_declined BOOLEAN, p_coach_answers JSONB,
    p_consent_version INTEGER, p_consent_hash TEXT, p_package UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_card public.coach_cards;
    v_sub public.onboarding_submissions;
    v_rel UUID;
    v_rel_status TEXT;
    v_dob DATE;
    v_minor BOOLEAN;
    v_pkg UUID;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    SELECT * INTO v_card FROM public.coach_cards WHERE slug = lower(COALESCE(p_slug, '')) AND is_public;
    IF NOT FOUND OR NOT public.coach_module_enabled(v_card.coach_id) OR public.is_blocked_between(v_me, v_card.coach_id) THEN
        RAISE EXCEPTION 'Coach not found';
    END IF;
    IF v_card.coach_id = v_me THEN RAISE EXCEPTION 'You cannot coach yourself'; END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_me AND is_bot) THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    IF p_consent_version IS DISTINCT FROM 1 OR p_consent_hash IS NULL OR p_consent_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Consent is required';
    END IF;
    IF EXISTS (SELECT 1 FROM public.coaching_relationships WHERE rider_id = v_me AND status = 'active') THEN
        RAISE EXCEPTION 'End your current coaching relationship first';
    END IF;

    IF p_package IS NOT NULL THEN
        SELECT id INTO v_pkg FROM public.coach_packages WHERE id = p_package AND coach_id = v_card.coach_id AND is_active;
        IF v_pkg IS NULL THEN RAISE EXCEPTION 'Package not available'; END IF;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('onboarding:' || v_me::TEXT));
    v_dob := public.onboarding_validate(p_answers, p_health, p_health_declined, p_coach_answers, v_card.coach_id);
    v_minor := date_part('year', age(CURRENT_DATE, v_dob)) < 18;

    SELECT * INTO v_sub FROM public.onboarding_submissions WHERE coach_id = v_card.coach_id AND rider_id = v_me FOR UPDATE;
    SELECT id, status INTO v_rel, v_rel_status FROM public.coaching_relationships
        WHERE coach_id = v_card.coach_id AND rider_id = v_me AND status = 'pending';

    IF v_rel IS NULL THEN
        IF NOT v_card.accepting_athletes OR (v_card.max_athletes IS NOT NULL AND
            (SELECT count(*) FROM public.coaching_relationships r WHERE r.coach_id = v_card.coach_id AND r.status = 'active') >= v_card.max_athletes) THEN
            RAISE EXCEPTION 'This coach is not accepting new athletes right now';
        END IF;
        v_rel := public.create_coaching_request(v_card.coach_id, v_me, v_me);
    END IF;

    IF v_sub.id IS NULL THEN
        INSERT INTO public.onboarding_submissions (coach_id, rider_id, relationship_id, package_id, answers, health, health_declined, coach_answers,
                                                   consent_at, consent_version, consent_text_hash)
        VALUES (v_card.coach_id, v_me, v_rel, v_pkg, p_answers, CASE WHEN v_minor OR COALESCE(p_health_declined, FALSE) THEN NULL ELSE p_health END,
                COALESCE(p_health_declined, FALSE) AND NOT v_minor, COALESCE(p_coach_answers, '{}'::JSONB), NOW(), 1, p_consent_hash)
        RETURNING id INTO v_sub.id;
    ELSE
        UPDATE public.onboarding_submissions SET
            relationship_id = v_rel, package_id = v_pkg, status = 'submitted', answers = p_answers,
            health = CASE WHEN v_minor OR COALESCE(p_health_declined, FALSE) THEN NULL ELSE p_health END,
            health_declined = COALESCE(p_health_declined, FALSE) AND NOT v_minor,
            coach_answers = COALESCE(p_coach_answers, '{}'::JSONB),
            consent_at = NOW(), consent_version = 1, consent_text_hash = p_consent_hash, withdrawn_at = NULL,
            setup_applied_at = NULL, updated_at = NOW()
        WHERE id = v_sub.id;
    END IF;

    INSERT INTO public.notifications (user_id, actor_id, type) VALUES (v_card.coach_id, v_me, 'onboarding_submitted');
    RETURN v_sub.id;
END $$;
REVOKE ALL ON FUNCTION public.submit_onboarding(TEXT, JSONB, JSONB, BOOLEAN, JSONB, INTEGER, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_onboarding(TEXT, JSONB, JSONB, BOOLEAN, JSONB, INTEGER, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.coaching_accept_as(p_id UUID, p_actor UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_rider UUID;
    r public.coaching_relationships;
    v_old public.coaching_relationships;
    v_prev_sub TEXT;
    v_prev_claims TEXT;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    SELECT rider_id INTO v_rider FROM public.coaching_relationships WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such coaching request';
    END IF;
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
    -- An accepted application with a paid package asks the athlete to pay instead of the plain "accepted" notification.
    IF p_actor = r.coach_id AND EXISTS (
        SELECT 1 FROM public.onboarding_submissions s JOIN public.coach_packages k ON k.id = s.package_id
        WHERE s.coach_id = r.coach_id AND s.rider_id = r.rider_id AND s.status = 'submitted' AND k.is_active AND k.kind <> 'free') THEN
        INSERT INTO public.notifications (user_id, actor_id, type) VALUES (r.rider_id, p_actor, 'payment_requested');
    ELSE
        INSERT INTO public.notifications (user_id, actor_id, type)
            VALUES (r.initiated_by, p_actor, 'coach_accepted');
    END IF;

    v_prev_sub := current_setting('request.jwt.claim.sub', true);
    v_prev_claims := current_setting('request.jwt.claims', true);
    BEGIN
        PERFORM public.apply_onboarding_setup(r.id);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), TRUE);
        PERFORM set_config('request.jwt.claims', COALESCE(v_prev_claims, ''), TRUE);
    END;
END;
$$;

-- Packages shown on the application form (public card data only) and the athlete's current choice.
CREATE OR REPLACE FUNCTION public.coach_apply_info(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_coach UUID;
    v_card public.coach_cards;
    v_me UUID := auth.uid();
    v_sub public.onboarding_submissions;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    SELECT * INTO v_card FROM public.coach_cards WHERE slug = lower(COALESCE(p_slug, '')) AND is_public;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_coach := v_card.coach_id;
    IF NOT public.coach_module_enabled(v_coach) OR public.is_blocked_between(v_me, v_coach) THEN RETURN NULL; END IF;
    SELECT * INTO v_sub FROM public.onboarding_submissions WHERE coach_id = v_coach AND rider_id = v_me;
    RETURN jsonb_build_object(
        'slug', v_card.slug,
        'name', (SELECT public.profile_display_name(p.nickname, p.first_name, p.last_name) FROM public.profiles p WHERE p.id = v_coach),
        'accent', v_card.accent,
        'is_self', v_me = v_coach,
        'accepting_athletes', v_card.accepting_athletes
            AND (v_card.max_athletes IS NULL OR (SELECT count(*) FROM public.coaching_relationships r WHERE r.coach_id = v_coach AND r.status = 'active') < v_card.max_athletes),
        'has_active_coach', EXISTS (SELECT 1 FROM public.coaching_relationships r WHERE r.rider_id = v_me AND r.status = 'active'),
        'questions', COALESCE((SELECT jsonb_agg(jsonb_build_object('position', q.position, 'question', q.question) ORDER BY q.position)
                               FROM public.coach_card_questions q WHERE q.coach_id = v_coach), '[]'::JSONB),
        'submission_id', v_sub.id,
        'submission_status', CASE WHEN v_sub.id IS NULL THEN NULL ELSE v_sub.status END,
        'package_id', v_sub.package_id,
        'packages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'description', k.description, 'kind', k.kind,
                                                                   'interval', k.billing_interval, 'amount_cents', k.amount_cents, 'currency', k.currency)
                                                ORDER BY k.position, k.created_at)
                              FROM public.coach_packages k WHERE k.coach_id = v_coach AND k.is_active), '[]'::JSONB));
END $$;

-- Open payment prompts of the signed-in athlete: an active relationship whose accepted application chose a paid package
-- that has no running subscription (or, for one-time packages, no payment since the relationship started).
CREATE OR REPLACE FUNCTION public.my_payment_due()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('relationship_id', r.id, 'coach_id', r.coach_id, 'package_id', k.id, 'title', k.title,
                                            'kind', k.kind, 'interval', k.billing_interval, 'amount_cents', k.amount_cents, 'currency', k.currency))
        FROM public.coaching_relationships r
        JOIN public.onboarding_submissions s ON s.coach_id = r.coach_id AND s.rider_id = r.rider_id AND s.status = 'submitted'
        JOIN public.coach_packages k ON k.id = s.package_id AND k.is_active AND k.kind <> 'free'
        WHERE r.rider_id = auth.uid() AND r.status = 'active'
          AND public.coach_module_enabled(r.coach_id) AND public.coach_module_enabled(r.rider_id)
          AND NOT EXISTS (SELECT 1 FROM public.coach_subscriptions cs WHERE cs.rider_id = r.rider_id AND cs.coach_id = r.coach_id
                          AND cs.status IN ('active', 'trialing', 'past_due', 'incomplete'))
          AND NOT (k.kind = 'one_time' AND EXISTS (SELECT 1 FROM public.payments_ledger pl WHERE pl.rider_id = r.rider_id
                          AND pl.coach_id = r.coach_id AND pl.kind = 'payment' AND pl.created_at >= COALESCE(r.responded_at, r.created_at)))
    ), '[]'::JSONB);
END $$;
REVOKE ALL ON FUNCTION public.my_payment_due() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_payment_due() TO authenticated;
