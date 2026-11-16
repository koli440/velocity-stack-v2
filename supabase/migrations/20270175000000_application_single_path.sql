-- Applications: one notification only, and the coach accepts through the application review. Additive/idempotent.

-- Existing duplicates: the standard request notification is redundant when an application exists.
UPDATE public.notifications n SET read_at = NOW()
    WHERE n.type = 'coach_request' AND n.read_at IS NULL
      AND EXISTS (SELECT 1 FROM public.onboarding_submissions s
                  WHERE s.coach_id = n.user_id AND s.rider_id = n.actor_id AND s.status = 'submitted');

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

    -- The application is the single notification: drop the standard request notification created just above and
    -- silence any older unread one from a direct request.
    DELETE FROM public.notifications
        WHERE user_id = v_card.coach_id AND actor_id = v_me AND type = 'coach_request' AND read_at IS NULL AND created_at >= NOW();
    UPDATE public.notifications SET read_at = NOW()
        WHERE user_id = v_card.coach_id AND actor_id = v_me AND type = 'coach_request' AND read_at IS NULL;
    INSERT INTO public.notifications (user_id, actor_id, type) VALUES (v_card.coach_id, v_me, 'onboarding_submitted');
    RETURN v_sub.id;
END $$;

-- The standard accept path refuses relationships that came with an application: the coach must review it first.
CREATE OR REPLACE FUNCTION public.accept_coaching(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.onboarding_submissions s JOIN public.coaching_relationships r ON r.id = s.relationship_id
               WHERE r.id = p_id AND r.status = 'pending' AND r.coach_id = auth.uid() AND s.status = 'submitted') THEN
        RAISE EXCEPTION 'Review the application to accept this athlete';
    END IF;
    PERFORM public.coaching_accept_as(p_id, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.accept_coaching(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_coaching(UUID) TO authenticated;

-- Accepting from the application screen (coach only, submitted application on a pending relationship).
CREATE OR REPLACE FUNCTION public.accept_application(p_relationship UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.onboarding_submissions s JOIN public.coaching_relationships r ON r.id = s.relationship_id
                   WHERE r.id = p_relationship AND r.coach_id = auth.uid() AND r.status = 'pending' AND s.status = 'submitted') THEN
        RAISE EXCEPTION 'Application not found';
    END IF;
    PERFORM public.coaching_accept_as(p_relationship, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.accept_application(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_application(UUID) TO authenticated;

-- Pending relationships of the caller (as coach) that came with an application, so the UI can link to the review.
CREATE OR REPLACE FUNCTION public.my_application_links()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('relationship_id', r.id, 'application_id', s.id))
        FROM public.coaching_relationships r JOIN public.onboarding_submissions s ON s.relationship_id = r.id AND s.status = 'submitted'
        WHERE r.coach_id = auth.uid() AND r.status = 'pending'), '[]'::JSONB);
END;
$$;
REVOKE ALL ON FUNCTION public.my_application_links() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_application_links() TO authenticated;
