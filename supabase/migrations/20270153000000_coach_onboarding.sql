-- Coach module, phase 1c: athlete onboarding (questionnaire + GDPR consent), coach applications and auto-setup.
--
--  * onboarding_submissions holds the rider's answers; health answers live in their own column and are only
--    returned to the coach while the relationship is pending/active AND consent is given and not withdrawn.
--    Ending coaching therefore cuts the coach's access immediately.
--  * Tables have no client privileges; everything is a SECURITY DEFINER RPC. Coach-side and apply-side RPCs
--    check the `coach_module` flag of the coach; a rider's own withdraw/delete/read always work (privacy rights).
--  * submit_onboarding creates the rider-initiated coaching request (the rider's consent to coaching) through
--    create_coaching_request, so blocks, one-active-coach, cooldown and the pending cap stay as today.
--  * coaching_accept_as now calls apply_onboarding_setup after the accept; setup never blocks acceptance, never
--    overwrites existing FTP/weight data and is idempotent.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.coach_card_questions (
    coach_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 5),
    question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 200),
    PRIMARY KEY (coach_id, position)
);

CREATE TABLE IF NOT EXISTS public.onboarding_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    relationship_id UUID REFERENCES public.coaching_relationships(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'withdrawn')),
    questionnaire_version INTEGER NOT NULL DEFAULT 1,
    answers JSONB NOT NULL DEFAULT '{}'::JSONB,
    health JSONB,
    health_declined BOOLEAN NOT NULL DEFAULT FALSE,
    coach_answers JSONB NOT NULL DEFAULT '{}'::JSONB,
    consent_at TIMESTAMPTZ,
    consent_version INTEGER,
    consent_text_hash TEXT,
    withdrawn_at TIMESTAMPTZ,
    setup_applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (coach_id, rider_id),
    CHECK (octet_length(answers::TEXT) + octet_length(COALESCE(health::TEXT, '')) + octet_length(coach_answers::TEXT) <= 20000)
);
CREATE INDEX IF NOT EXISTS idx_onboarding_rider ON public.onboarding_submissions (rider_id);

CREATE TABLE IF NOT EXISTS public.onboarding_setup_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES public.onboarding_submissions(id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.coach_card_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_setup_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_card_questions, public.onboarding_submissions, public.onboarding_setup_log FROM PUBLIC, anon, authenticated;

-- Validation helpers (internal) ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ob_num(p JSONB, k TEXT, lo NUMERIC, hi NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v NUMERIC;
BEGIN
    IF p IS NULL OR p -> k IS NULL OR jsonb_typeof(p -> k) = 'null' THEN RETURN NULL; END IF;
    IF jsonb_typeof(p -> k) <> 'number' THEN RAISE EXCEPTION 'Invalid answer: %', k; END IF;
    v := (p ->> k)::NUMERIC;
    IF v < lo OR v > hi THEN RAISE EXCEPTION 'Invalid answer: %', k; END IF;
    RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.ob_txt(p JSONB, k TEXT, maxlen INTEGER DEFAULT 1000, allowed TEXT[] DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v TEXT;
BEGIN
    IF p IS NULL OR p -> k IS NULL OR jsonb_typeof(p -> k) = 'null' THEN RETURN NULL; END IF;
    IF jsonb_typeof(p -> k) <> 'string' THEN RAISE EXCEPTION 'Invalid answer: %', k; END IF;
    v := btrim(p ->> k);
    IF char_length(v) > maxlen OR (allowed IS NOT NULL AND v <> '' AND NOT v = ANY (allowed)) THEN
        RAISE EXCEPTION 'Invalid answer: %', k;
    END IF;
    RETURN NULLIF(v, '');
END $$;

CREATE OR REPLACE FUNCTION public.ob_date(p JSONB, k TEXT, lo DATE, hi DATE)
RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v DATE;
BEGIN
    IF p IS NULL OR p -> k IS NULL OR jsonb_typeof(p -> k) = 'null' OR p ->> k = '' THEN RETURN NULL; END IF;
    IF jsonb_typeof(p -> k) <> 'string' OR (p ->> k) !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid answer: %', k; END IF;
    BEGIN
        v := (p ->> k)::DATE;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid answer: %', k;
    END;
    IF v < lo OR v > hi THEN RAISE EXCEPTION 'Invalid answer: %', k; END IF;
    RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.ob_section(p JSONB, k TEXT, allowed TEXT[])
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s JSONB := p -> k; key TEXT;
BEGIN
    IF s IS NULL OR jsonb_typeof(s) = 'null' THEN RETURN '{}'::JSONB; END IF;
    IF jsonb_typeof(s) <> 'object' THEN RAISE EXCEPTION 'Invalid answer: %', k; END IF;
    FOR key IN SELECT jsonb_object_keys(s) LOOP
        IF NOT key = ANY (allowed) THEN RAISE EXCEPTION 'Invalid answer: %.%', k, key; END IF;
    END LOOP;
    RETURN s;
END $$;

-- Validates the questionnaire answers (version 1); returns the date of birth.
CREATE OR REPLACE FUNCTION public.onboarding_validate(p_answers JSONB, p_health JSONB, p_declined BOOLEAN, p_coach_answers JSONB, p_coach UUID)
RETURNS DATE
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
    a JSONB;
    k TEXT;
    e JSONB;
    v_dob DATE;
    v_age INTEGER;
    v_today DATE := CURRENT_DATE;
    v_n INTEGER;
    v_days TEXT[] := ARRAY['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
BEGIN
    IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN RAISE EXCEPTION 'Invalid answers'; END IF;
    IF octet_length(p_answers::TEXT) + octet_length(COALESCE(p_health::TEXT, '')) + octet_length(COALESCE(p_coach_answers::TEXT, '')) > 20000 THEN
        RAISE EXCEPTION 'Answers are too long';
    END IF;
    FOR k IN SELECT jsonb_object_keys(p_answers) LOOP
        IF NOT k = ANY (ARRAY['about', 'goals', 'history', 'availability', 'equipment']) THEN RAISE EXCEPTION 'Invalid answer: %', k; END IF;
    END LOOP;

    a := public.ob_section(p_answers, 'about', ARRAY['dob', 'sex', 'height_cm', 'weight_kg', 'country', 'language']);
    v_dob := public.ob_date(a, 'dob', DATE '1920-01-01', v_today - 10 * 365);
    IF v_dob IS NULL THEN RAISE EXCEPTION 'Date of birth is required'; END IF;
    PERFORM public.ob_txt(a, 'sex', 20, ARRAY['female', 'male', 'other', 'na']);
    PERFORM public.ob_num(a, 'height_cm', 100, 250);
    PERFORM public.ob_num(a, 'weight_kg', 30, 200);
    PERFORM public.ob_txt(a, 'country', 60);
    PERFORM public.ob_txt(a, 'language', 40);

    a := public.ob_section(p_answers, 'goals', ARRAY['main_goal', 'goal_text', 'events', 'timeframe', 'why_now']);
    PERFORM public.ob_txt(a, 'main_goal', 40);
    PERFORM public.ob_txt(a, 'goal_text', 1000);
    PERFORM public.ob_txt(a, 'timeframe', 100);
    PERFORM public.ob_txt(a, 'why_now', 1000);
    IF a ? 'events' AND jsonb_typeof(a -> 'events') <> 'null' THEN
        IF jsonb_typeof(a -> 'events') <> 'array' OR jsonb_array_length(a -> 'events') > 5 THEN RAISE EXCEPTION 'Invalid answer: events'; END IF;
        FOR e IN SELECT * FROM jsonb_array_elements(a -> 'events') LOOP
            IF jsonb_typeof(e) <> 'object' OR public.ob_txt(e, 'name', 80) IS NULL THEN RAISE EXCEPTION 'Invalid answer: events'; END IF;
            PERFORM public.ob_date(e, 'date', DATE '2000-01-01', DATE '2100-12-31');
            PERFORM public.ob_txt(e, 'priority', 1, ARRAY['A', 'B', 'C']);
        END LOOP;
    END IF;

    a := public.ob_section(p_answers, 'history', ARRAY['years_riding', 'weekly_hours', 'weekly_km', 'structure', 'ftp_w', 'ftp_date',
                                                       'ftp_method', 'max_hr', 'lt1_w', 'lt2_w', 'indoor_pct', 'other_sports']);
    PERFORM public.ob_num(a, 'years_riding', 0, 80);
    PERFORM public.ob_num(a, 'weekly_hours', 0, 60);
    PERFORM public.ob_num(a, 'weekly_km', 0, 3000);
    PERFORM public.ob_txt(a, 'structure', 20, ARRAY['none', 'self', 'plan', 'coach']);
    PERFORM public.ob_num(a, 'ftp_w', 50, 700);
    PERFORM public.ob_date(a, 'ftp_date', DATE '2000-01-01', v_today);
    PERFORM public.ob_txt(a, 'ftp_method', 60);
    PERFORM public.ob_num(a, 'max_hr', 100, 250);
    PERFORM public.ob_num(a, 'lt1_w', 1, 2500);
    PERFORM public.ob_num(a, 'lt2_w', 1, 2500);
    PERFORM public.ob_num(a, 'indoor_pct', 0, 100);
    PERFORM public.ob_txt(a, 'other_sports', 200);

    a := public.ob_section(p_answers, 'availability', ARRAY['hours_per_week', 'weekdays', 'blackout', 'contact_style']);
    PERFORM public.ob_num(a, 'hours_per_week', 0, 60);
    PERFORM public.ob_txt(a, 'contact_style', 300);
    IF a ? 'weekdays' AND jsonb_typeof(a -> 'weekdays') <> 'null' THEN
        IF jsonb_typeof(a -> 'weekdays') <> 'object' THEN RAISE EXCEPTION 'Invalid answer: weekdays'; END IF;
        FOR k IN SELECT jsonb_object_keys(a -> 'weekdays') LOOP
            IF NOT k = ANY (v_days) THEN RAISE EXCEPTION 'Invalid answer: weekdays'; END IF;
            PERFORM public.ob_txt(a -> 'weekdays', k, 10, ARRAY['none', 'short', 'long']);
        END LOOP;
    END IF;
    IF a ? 'blackout' AND jsonb_typeof(a -> 'blackout') <> 'null' THEN
        IF jsonb_typeof(a -> 'blackout') <> 'array' OR jsonb_array_length(a -> 'blackout') > 10 THEN RAISE EXCEPTION 'Invalid answer: blackout'; END IF;
        FOR e IN SELECT * FROM jsonb_array_elements(a -> 'blackout') LOOP
            IF jsonb_typeof(e) <> 'object' OR public.ob_date(e, 'date', DATE '2000-01-01', DATE '2100-12-31') IS NULL THEN RAISE EXCEPTION 'Invalid answer: blackout'; END IF;
            PERFORM public.ob_txt(e, 'note', 200);
        END LOOP;
    END IF;

    a := public.ob_section(p_answers, 'equipment', ARRAY['power_meter', 'hr', 'smart_trainer', 'head_unit', 'bike_type', 'platforms']);
    PERFORM public.ob_txt(a, 'power_meter', 100);
    PERFORM public.ob_txt(a, 'hr', 100);
    PERFORM public.ob_txt(a, 'smart_trainer', 100);
    PERFORM public.ob_txt(a, 'head_unit', 100);
    PERFORM public.ob_txt(a, 'bike_type', 100);
    IF a ? 'platforms' AND jsonb_typeof(a -> 'platforms') <> 'null' THEN
        IF jsonb_typeof(a -> 'platforms') <> 'array' OR jsonb_array_length(a -> 'platforms') > 10 THEN RAISE EXCEPTION 'Invalid answer: platforms'; END IF;
        FOR e IN SELECT * FROM jsonb_array_elements(a -> 'platforms') LOOP
            IF jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') > 30 THEN RAISE EXCEPTION 'Invalid answer: platforms'; END IF;
        END LOOP;
    END IF;

    -- Health (sensitive): never collected for under-18s; otherwise optional.
    v_age := date_part('year', age(v_today, v_dob));
    IF p_health IS NOT NULL AND jsonb_typeof(p_health) <> 'null' THEN
        IF v_age < 18 OR COALESCE(p_declined, FALSE) THEN RAISE EXCEPTION 'Health answers are not accepted'; END IF;
        IF jsonb_typeof(p_health) <> 'object' THEN RAISE EXCEPTION 'Invalid answer: health'; END IF;
        FOR k IN SELECT jsonb_object_keys(p_health) LOOP
            IF NOT k = ANY (ARRAY['parq', 'notes', 'clearance']) THEN RAISE EXCEPTION 'Invalid answer: health'; END IF;
        END LOOP;
        IF jsonb_typeof(p_health -> 'parq') <> 'array' OR jsonb_array_length(p_health -> 'parq') <> 7 THEN RAISE EXCEPTION 'Invalid answer: health'; END IF;
        FOR e IN SELECT * FROM jsonb_array_elements(p_health -> 'parq') LOOP
            IF jsonb_typeof(e) <> 'boolean' THEN RAISE EXCEPTION 'Invalid answer: health'; END IF;
        END LOOP;
        PERFORM public.ob_txt(p_health, 'notes', 1000);
        IF p_health ? 'clearance' AND jsonb_typeof(p_health -> 'clearance') NOT IN ('boolean', 'null') THEN RAISE EXCEPTION 'Invalid answer: health'; END IF;
    END IF;

    -- Coach-defined questions: keys must be the positions of the coach's questions.
    IF p_coach_answers IS NOT NULL AND jsonb_typeof(p_coach_answers) <> 'null' THEN
        IF jsonb_typeof(p_coach_answers) <> 'object' THEN RAISE EXCEPTION 'Invalid answer: coach questions'; END IF;
        FOR k IN SELECT jsonb_object_keys(p_coach_answers) LOOP
            IF NOT EXISTS (SELECT 1 FROM public.coach_card_questions q WHERE q.coach_id = p_coach AND q.position::TEXT = k) THEN
                RAISE EXCEPTION 'Invalid answer: coach questions';
            END IF;
            PERFORM public.ob_txt(p_coach_answers, k, 1000);
        END LOOP;
    END IF;
    RETURN v_dob;
END $$;
REVOKE ALL ON FUNCTION public.ob_num(JSONB, TEXT, NUMERIC, NUMERIC), public.ob_txt(JSONB, TEXT, INTEGER, TEXT[]),
    public.ob_date(JSONB, TEXT, DATE, DATE), public.ob_section(JSONB, TEXT, TEXT[]),
    public.onboarding_validate(JSONB, JSONB, BOOLEAN, JSONB, UUID) FROM PUBLIC, anon, authenticated;

-- Coach questions -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_coach_questions()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.coach_module_require();
    RETURN COALESCE((SELECT jsonb_agg(question ORDER BY position) FROM public.coach_card_questions WHERE coach_id = auth.uid()), '[]'::JSONB);
END $$;

-- Replaces the caller's (max 5) optional questions with the given list of strings.
CREATE OR REPLACE FUNCTION public.save_coach_questions(p JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    q TEXT;
    i INTEGER := 0;
BEGIN
    PERFORM public.coach_module_require();
    IF p IS NULL OR jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) > 5 THEN RAISE EXCEPTION 'At most 5 questions'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('coachq:' || auth.uid()::TEXT));
    DELETE FROM public.coach_card_questions WHERE coach_id = auth.uid();
    FOR q IN SELECT btrim(x) FROM jsonb_array_elements_text(p) AS x LOOP
        IF q = '' THEN CONTINUE; END IF;
        IF char_length(q) > 200 THEN RAISE EXCEPTION 'A question can have at most 200 characters'; END IF;
        i := i + 1;
        INSERT INTO public.coach_card_questions (coach_id, position, question) VALUES (auth.uid(), i, q);
    END LOOP;
END $$;

-- Apply screen data for a published card: who the coach is, their questions and the caller's own status.
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
        'submission_status', CASE WHEN v_sub.id IS NULL THEN NULL ELSE v_sub.status END);
END $$;

-- Submit / re-submit an application ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_onboarding(
    p_slug TEXT, p_answers JSONB, p_health JSONB, p_health_declined BOOLEAN, p_coach_answers JSONB,
    p_consent_version INTEGER, p_consent_hash TEXT)
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
        INSERT INTO public.onboarding_submissions (coach_id, rider_id, relationship_id, answers, health, health_declined, coach_answers,
                                                   consent_at, consent_version, consent_text_hash)
        VALUES (v_card.coach_id, v_me, v_rel, p_answers, CASE WHEN v_minor OR COALESCE(p_health_declined, FALSE) THEN NULL ELSE p_health END,
                COALESCE(p_health_declined, FALSE) AND NOT v_minor, COALESCE(p_coach_answers, '{}'::JSONB), NOW(), 1, p_consent_hash)
        RETURNING id INTO v_sub.id;
    ELSE
        UPDATE public.onboarding_submissions SET
            relationship_id = v_rel, status = 'submitted', answers = p_answers,
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

-- The rider edits answers of a pending or active submission.
CREATE OR REPLACE FUNCTION public.edit_onboarding_answers(
    p_id UUID, p_answers JSONB, p_health JSONB, p_health_declined BOOLEAN, p_coach_answers JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_sub public.onboarding_submissions;
    v_dob DATE;
    v_minor BOOLEAN;
BEGIN
    SELECT * INTO v_sub FROM public.onboarding_submissions WHERE id = p_id AND rider_id = auth.uid() FOR UPDATE;
    IF NOT FOUND OR v_sub.status <> 'submitted' THEN RAISE EXCEPTION 'Not found'; END IF;
    v_dob := public.onboarding_validate(p_answers, p_health, p_health_declined, p_coach_answers, v_sub.coach_id);
    v_minor := date_part('year', age(CURRENT_DATE, v_dob)) < 18;
    UPDATE public.onboarding_submissions SET
        answers = p_answers,
        health = CASE WHEN v_minor OR COALESCE(p_health_declined, FALSE) THEN NULL ELSE p_health END,
        health_declined = COALESCE(p_health_declined, FALSE) AND NOT v_minor,
        coach_answers = COALESCE(p_coach_answers, '{}'::JSONB),
        updated_at = NOW()
    WHERE id = p_id;
END $$;

-- Cuts the coach's access right away; a still pending request is cancelled. Always allowed (privacy right).
CREATE OR REPLACE FUNCTION public.withdraw_onboarding_consent(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_sub public.onboarding_submissions;
BEGIN
    SELECT * INTO v_sub FROM public.onboarding_submissions WHERE id = p_id AND rider_id = auth.uid() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
    UPDATE public.onboarding_submissions SET status = 'withdrawn', withdrawn_at = NOW(), updated_at = NOW() WHERE id = p_id;
    UPDATE public.coaching_relationships SET status = 'ended', ended_at = NOW(), ended_by = auth.uid()
        WHERE id = v_sub.relationship_id AND status = 'pending';
END $$;

-- Deletes the rider's answers entirely (also cancels a pending request).
CREATE OR REPLACE FUNCTION public.delete_onboarding_answers(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_sub public.onboarding_submissions;
BEGIN
    SELECT * INTO v_sub FROM public.onboarding_submissions WHERE id = p_id AND rider_id = auth.uid() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
    UPDATE public.coaching_relationships SET status = 'ended', ended_at = NOW(), ended_by = auth.uid()
        WHERE id = v_sub.relationship_id AND status = 'pending';
    DELETE FROM public.onboarding_submissions WHERE id = p_id;
END $$;

-- The rider's own submissions with what auto-setup created.
CREATE OR REPLACE FUNCTION public.my_onboarding()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id, 'status', s.status, 'coach_name', public.profile_display_name(p.nickname, p.first_name, p.last_name),
        'coach_slug', (SELECT c.slug FROM public.coach_cards c WHERE c.coach_id = s.coach_id),
        'answers', s.answers, 'health', s.health, 'health_declined', s.health_declined, 'coach_answers', s.coach_answers,
        'consent_at', s.consent_at, 'withdrawn_at', s.withdrawn_at, 'setup_applied_at', s.setup_applied_at,
        'relationship_status', (SELECT r.status FROM public.coaching_relationships r WHERE r.id = s.relationship_id),
        'setup', COALESCE((SELECT jsonb_agg(jsonb_build_object('target', l.target, 'status', l.status, 'detail', l.detail) ORDER BY l.created_at)
                           FROM public.onboarding_setup_log l WHERE l.submission_id = s.id), '[]'::JSONB))
        ORDER BY s.updated_at DESC), '[]'::JSONB)
    FROM public.onboarding_submissions s JOIN public.profiles p ON p.id = s.coach_id
    WHERE s.rider_id = auth.uid()
$$;

-- Coach side ----------------------------------------------------------------------------------
-- Pending applications (consent given, not withdrawn). Health answers are reduced to a flag.
CREATE OR REPLACE FUNCTION public.coach_applications()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.coach_module_require();
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', s.id, 'relationship_id', r.id, 'created_at', s.updated_at,
            'rider_name', public.profile_display_name(p.nickname, p.first_name, p.last_name),
            'main_goal', s.answers #>> '{goals,main_goal}',
            'health_flag', COALESCE((SELECT bool_or(x::BOOLEAN) FROM jsonb_array_elements_text(s.health -> 'parq') x), FALSE))
            ORDER BY s.updated_at DESC)
        FROM public.onboarding_submissions s
        JOIN public.coaching_relationships r ON r.id = s.relationship_id AND r.status = 'pending' AND r.coach_id = auth.uid()
        JOIN public.profiles p ON p.id = s.rider_id
        WHERE s.coach_id = auth.uid() AND s.status = 'submitted' AND s.consent_at IS NOT NULL AND s.withdrawn_at IS NULL
          AND NOT public.is_blocked_between(auth.uid(), s.rider_id)), '[]'::JSONB);
END $$;

-- Full submission for a pending application or an active athlete. Nothing once coaching ended / consent withdrawn.
CREATE OR REPLACE FUNCTION public.coach_application_get(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    s public.onboarding_submissions;
    r public.coaching_relationships;
    v_dob DATE;
BEGIN
    PERFORM public.coach_module_require();
    SELECT * INTO s FROM public.onboarding_submissions WHERE id = p_id AND coach_id = auth.uid();
    IF NOT FOUND OR s.status <> 'submitted' OR s.consent_at IS NULL OR s.withdrawn_at IS NOT NULL THEN RETURN NULL; END IF;
    SELECT * INTO r FROM public.coaching_relationships WHERE id = s.relationship_id;
    IF NOT FOUND OR r.status NOT IN ('pending', 'active') OR public.is_blocked_between(auth.uid(), s.rider_id) THEN RETURN NULL; END IF;
    v_dob := NULLIF(s.answers #>> '{about,dob}', '')::DATE;
    RETURN jsonb_build_object(
        'id', s.id, 'rider_id', s.rider_id, 'relationship_id', r.id, 'relationship_status', r.status,
        'rider_name', (SELECT public.profile_display_name(p.nickname, p.first_name, p.last_name) FROM public.profiles p WHERE p.id = s.rider_id),
        'answers', s.answers, 'health', s.health, 'health_declined', s.health_declined,
        'minor', v_dob IS NOT NULL AND date_part('year', age(CURRENT_DATE, v_dob)) < 18,
        'health_flag', COALESCE((SELECT bool_or(x::BOOLEAN) FROM jsonb_array_elements_text(s.health -> 'parq') x), FALSE),
        'questions', COALESCE((SELECT jsonb_agg(jsonb_build_object('position', q.position, 'question', q.question) ORDER BY q.position)
                               FROM public.coach_card_questions q WHERE q.coach_id = s.coach_id), '[]'::JSONB),
        'coach_answers', s.coach_answers, 'submitted_at', s.updated_at, 'setup_applied_at', s.setup_applied_at);
END $$;

-- Auto-setup on acceptance (internal) ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_onboarding_setup(p_relationship UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    s public.onboarding_submissions;
    v_prev_sub TEXT := current_setting('request.jwt.claim.sub', true);
    v_prev_claims TEXT := current_setting('request.jwt.claims', true);
    v_today DATE := CURRENT_DATE;
    a JSONB;
    v_date DATE;
    v_num NUMERIC;
    v_lt1 NUMERIC;
    v_lt2 NUMERIC;
    e JSONB;
    v_n INTEGER;
BEGIN
    SELECT * INTO s FROM public.onboarding_submissions
        WHERE relationship_id = p_relationship AND status = 'submitted' AND consent_at IS NOT NULL AND withdrawn_at IS NULL
          AND setup_applied_at IS NULL
        FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    -- Rows are written as the rider, so they are not stamped as set by the coach.
    PERFORM set_config('request.jwt.claim.sub', s.rider_id::TEXT, TRUE);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', s.rider_id, 'role', 'authenticated')::TEXT, TRUE);

    a := s.answers -> 'history';
    BEGIN
        v_num := public.ob_num(a, 'ftp_w', 50, 700);
        IF v_num IS NOT NULL THEN
            v_date := COALESCE(public.ob_date(a, 'ftp_date', DATE '2000-01-01', v_today), v_today);
            IF EXISTS (SELECT 1 FROM public.ftp_history WHERE user_id = s.rider_id) THEN
                INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'ftp', 'skipped', 'existing FTP kept');
            ELSE
                INSERT INTO public.ftp_history (user_id, effective_from, ftp_w) VALUES (s.rider_id, v_date, v_num::INTEGER);
                INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'ftp', 'created', v_num::INTEGER || ' W from ' || v_date);
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'ftp', 'failed', left(SQLERRM, 200));
    END;

    BEGIN
        v_num := public.ob_num(s.answers -> 'about', 'weight_kg', 30, 200);
        IF v_num IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM public.weight_history WHERE user_id = s.rider_id) THEN
                INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'weight', 'skipped', 'existing weight kept');
            ELSE
                INSERT INTO public.weight_history (user_id, effective_from, weight_kg) VALUES (s.rider_id, v_today, round(v_num, 1));
                INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'weight', 'created', round(v_num, 1) || ' kg');
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'weight', 'failed', left(SQLERRM, 200));
    END;

    BEGIN
        v_lt1 := public.ob_num(a, 'lt1_w', 1, 2500);
        v_lt2 := public.ob_num(a, 'lt2_w', 1, 2500);
        IF v_lt1 IS NOT NULL OR v_lt2 IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM public.lactate_threshold_history WHERE user_id = s.rider_id) THEN
                INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'thresholds', 'skipped', 'existing thresholds kept');
            ELSE
                INSERT INTO public.lactate_threshold_history (user_id, effective_from, lt1_power_w, lt2_power_w)
                    VALUES (s.rider_id, v_today, v_lt1::INTEGER, v_lt2::INTEGER);
                INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'thresholds', 'created', NULL);
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'thresholds', 'failed', left(SQLERRM, 200));
    END;

    v_n := 0;
    FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(s.answers #> '{goals,events}', '[]'::JSONB)) LOOP
        BEGIN
            v_date := public.ob_date(e, 'date', DATE '2000-01-01', DATE '2100-12-31');
            IF v_date IS NULL OR v_date <= v_today OR v_n >= 5 THEN CONTINUE; END IF;
            IF EXISTS (SELECT 1 FROM public.calendar_races WHERE rider_id = s.rider_id AND race_date = v_date AND lower(name) = lower(btrim(e ->> 'name'))) THEN
                CONTINUE;
            END IF;
            INSERT INTO public.calendar_races (rider_id, race_date, name, priority)
                VALUES (s.rider_id, v_date, btrim(e ->> 'name'), COALESCE(public.ob_txt(e, 'priority', 1, ARRAY['A', 'B', 'C']), 'B'));
            v_n := v_n + 1;
            INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'race', 'created', btrim(e ->> 'name') || ' ' || v_date);
        EXCEPTION WHEN OTHERS THEN
            INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'race', 'failed', left(SQLERRM, 200));
        END;
    END LOOP;

    v_n := 0;
    FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(s.answers #> '{availability,blackout}', '[]'::JSONB)) LOOP
        BEGIN
            v_date := public.ob_date(e, 'date', DATE '2000-01-01', DATE '2100-12-31');
            IF v_date IS NULL OR v_date < v_today OR v_n >= 10 THEN CONTINUE; END IF;
            IF EXISTS (SELECT 1 FROM public.calendar_notes WHERE rider_id = s.rider_id AND note_date = v_date AND title = 'Unavailable') THEN CONTINUE; END IF;
            INSERT INTO public.calendar_notes (rider_id, note_date, title, body)
                VALUES (s.rider_id, v_date, 'Unavailable', COALESCE(public.ob_txt(e, 'note', 200), ''));
            v_n := v_n + 1;
            INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'calendar_note', 'created', v_date::TEXT);
        EXCEPTION WHEN OTHERS THEN
            INSERT INTO public.onboarding_setup_log (submission_id, target, status, detail) VALUES (s.id, 'calendar_note', 'failed', left(SQLERRM, 200));
        END;
    END LOOP;

    UPDATE public.onboarding_submissions SET setup_applied_at = NOW() WHERE id = s.id;
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), TRUE);
    PERFORM set_config('request.jwt.claims', COALESCE(v_prev_claims, ''), TRUE);
END $$;
REVOKE ALL ON FUNCTION public.apply_onboarding_setup(UUID) FROM PUBLIC, anon, authenticated;

-- Same body as 20261201000000, plus the setup hook (never blocks acceptance).
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
    INSERT INTO public.notifications (user_id, actor_id, type)
        VALUES (r.initiated_by, p_actor, 'coach_accepted');

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
REVOKE ALL ON FUNCTION public.coaching_accept_as(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Grants ------------------------------------------------------------------------------------
DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'my_coach_questions()', 'save_coach_questions(jsonb)', 'coach_apply_info(text)',
        'submit_onboarding(text,jsonb,jsonb,boolean,jsonb,integer,text)', 'edit_onboarding_answers(uuid,jsonb,jsonb,boolean,jsonb)',
        'withdraw_onboarding_consent(uuid)', 'delete_onboarding_answers(uuid)', 'my_onboarding()',
        'coach_applications()', 'coach_application_get(uuid)']
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;
