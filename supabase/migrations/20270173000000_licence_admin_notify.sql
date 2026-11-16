-- Notify admins (one unread per admin) when a coach submits a licence with evidence for review. Additive/idempotent.

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
        'payment_requested', 'licence_submitted'
    ));

CREATE OR REPLACE FUNCTION public.save_my_licence(p_body TEXT, p_level TEXT, p_number TEXT DEFAULT NULL,
                                                  p_valid_until DATE DEFAULT NULL, p_evidence_path TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_level TEXT := btrim(COALESCE(p_level, ''));
    v_number TEXT := NULLIF(btrim(COALESCE(p_number, '')), '');
    v_path TEXT := NULLIF(btrim(COALESCE(p_evidence_path, '')), '');
    b public.licence_bodies;
    v_status TEXT;
BEGIN
    PERFORM public.coach_module_require();
    SELECT * INTO b FROM public.licence_bodies WHERE id = p_body AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown licence body'; END IF;
    IF NOT (v_level = ANY (b.levels)) THEN RAISE EXCEPTION 'Unknown licence level'; END IF;
    IF v_number IS NOT NULL AND char_length(v_number) > 60 THEN RAISE EXCEPTION 'Licence number is too long'; END IF;
    IF p_valid_until IS NOT NULL AND p_valid_until < CURRENT_DATE - 1 THEN RAISE EXCEPTION 'Licence is already expired'; END IF;
    IF v_path IS NOT NULL AND (left(v_path, 37) <> v_me::TEXT || '/' OR v_path ~ '\.\.' OR char_length(v_path) > 300) THEN
        RAISE EXCEPTION 'Invalid evidence file';
    END IF;
    INSERT INTO public.coach_licences (coach_id, body_id, level, licence_number, valid_until, evidence_path, status)
        VALUES (v_me, b.id, v_level, v_number, p_valid_until, v_path, CASE WHEN v_path IS NULL THEN 'unverified' ELSE 'pending' END)
        ON CONFLICT (coach_id) DO UPDATE
        SET body_id = EXCLUDED.body_id, level = EXCLUDED.level, licence_number = EXCLUDED.licence_number,
            valid_until = EXCLUDED.valid_until, evidence_path = EXCLUDED.evidence_path;
    SELECT status INTO v_status FROM public.coach_licences WHERE coach_id = v_me;
    INSERT INTO public.licence_audit (licence_id, actor_id, action)
        SELECT id, v_me, 'saved' FROM public.coach_licences WHERE coach_id = v_me;
    IF v_status = 'pending' THEN
        INSERT INTO public.notifications (user_id, actor_id, type)
            SELECT p.id, NULL, 'licence_submitted' FROM public.profiles p
            WHERE p.is_admin AND NOT EXISTS (
                SELECT 1 FROM public.notifications n WHERE n.user_id = p.id AND n.type = 'licence_submitted' AND n.read_at IS NULL);
    END IF;
    RETURN v_status;
END $$;
