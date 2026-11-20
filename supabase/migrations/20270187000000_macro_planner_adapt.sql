-- Macro planner phase 2 (docs/macro-planner.md, "Adapting the plan"): disruptions, B/C races, availability weeks,
-- adherence reviews, an audit trail of applied suggestions and optional sharing of the reasoning with the athlete.
-- Same rules as 20270186000000_macro_planner.sql: dark behind the `macro_planner` flag, every RPC calls macro_planner_require(),
-- is_coach_of() and stamps the coach from auth.uid(); no client table privileges. Additive and idempotent.
-- Health data (disruptions) and availability are coach-only: my_macro_plan() never returns them.
-- Suggestions are computed in the app; the server only stores what the coach explicitly applied (macro_plan_apply) and logs it.

-- 1. Columns ------------------------------------------------------------------------------
ALTER TABLE public.macro_plans ADD COLUMN IF NOT EXISTS share_reasoning BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.macro_plans ADD COLUMN IF NOT EXISTS plan_rationale TEXT NOT NULL DEFAULT '' CHECK (char_length(plan_rationale) <= 1000);
ALTER TABLE public.macro_plan_weeks ADD COLUMN IF NOT EXISTS rationale TEXT NOT NULL DEFAULT '' CHECK (char_length(rationale) <= 500);

-- 2. Tables -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.macro_plan_disruptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES public.macro_plans(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('illness', 'injury')),
    severity TEXT NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe')),
    start_date DATE NOT NULL CHECK (start_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
    end_date DATE CHECK (end_date IS NULL OR end_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
    note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date IS NULL OR end_date >= start_date),
    CHECK (end_date IS NULL OR end_date - start_date <= 365)
);
CREATE INDEX IF NOT EXISTS idx_macro_plan_disruptions_plan ON public.macro_plan_disruptions (plan_id);

CREATE TABLE IF NOT EXISTS public.macro_plan_races (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES public.macro_plans(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    race_date DATE NOT NULL CHECK (race_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
    priority TEXT NOT NULL CHECK (priority IN ('B', 'C'))
);
CREATE INDEX IF NOT EXISTS idx_macro_plan_races_plan ON public.macro_plan_races (plan_id);

CREATE TABLE IF NOT EXISTS public.macro_plan_availability (
    plan_id UUID NOT NULL REFERENCES public.macro_plans(id) ON DELETE CASCADE,
    week_start DATE NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
    availability_pct INTEGER NOT NULL CHECK (availability_pct BETWEEN 0 AND 100),
    reason TEXT NOT NULL CHECK (reason IN ('travel', 'holiday', 'work', 'other')),
    note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
    PRIMARY KEY (plan_id, week_start)
);

-- Append only: written by macro_plan_apply, never updated or deleted by a client.
CREATE TABLE IF NOT EXISTS public.macro_plan_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES public.macro_plans(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    source TEXT NOT NULL CHECK (source IN ('disruption', 'availability', 'adherence', 'manual')),
    option_key TEXT NOT NULL CHECK (char_length(option_key) BETWEEN 1 AND 40),
    summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 300),
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_macro_plan_audit_plan ON public.macro_plan_audit (plan_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.macro_plan_reviews (
    plan_id UUID NOT NULL REFERENCES public.macro_plans(id) ON DELETE CASCADE,
    week_start DATE NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
    reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 200),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'done')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (plan_id, week_start)
);

ALTER TABLE public.macro_plan_disruptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.macro_plan_races ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.macro_plan_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.macro_plan_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.macro_plan_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.macro_plan_disruptions, public.macro_plan_races, public.macro_plan_availability,
    public.macro_plan_audit, public.macro_plan_reviews FROM PUBLIC, anon, authenticated;

-- 3. Helpers --------------------------------------------------------------------------------
-- The caller's own plan, with the flag on and an active coaching relationship; returns the rider.
CREATE OR REPLACE FUNCTION public.macro_plan_authorize(p_plan UUID)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_rider UUID;
BEGIN
    PERFORM public.macro_planner_require();
    SELECT rider_id INTO v_rider FROM public.macro_plans WHERE id = p_plan AND coach_id = auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'No such plan'; END IF;
    IF NOT public.is_coach_of(v_rider) THEN RAISE EXCEPTION 'You are not coaching this rider'; END IF;
    RETURN v_rider;
END;
$$;
REVOKE ALL ON FUNCTION public.macro_plan_authorize(UUID) FROM PUBLIC, anon, authenticated;

-- 4. Plan JSON: adds sharing flags, rationale and B/C races (coach and athlete shape; the athlete RPC strips what is not shared)
CREATE OR REPLACE FUNCTION public.macro_plan_json(p_plan UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'id', m.id, 'coach_id', m.coach_id, 'rider_id', m.rider_id,
        'coach_name', public.profile_display_name(p.nickname, p.first_name, p.last_name),
        'race_name', m.race_name, 'race_date', m.race_date, 'race_length', m.race_length,
        'template', m.template, 'build_weeks', m.build_weeks, 'recovery_weeks', m.recovery_weeks,
        'ramp_ceiling_pct', m.ramp_ceiling_pct, 'start_weekly_tl', m.start_weekly_tl,
        'baseline_source', m.baseline_source, 'goal_ctl', m.goal_ctl, 'status', m.status,
        'updated_at', m.updated_at,
        'share_reasoning', m.share_reasoning, 'plan_rationale', m.plan_rationale,
        'races', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'race_date', r.race_date, 'priority', r.priority)
                                            ORDER BY r.race_date, r.name)
                           FROM public.macro_plan_races r WHERE r.plan_id = m.id), '[]'::JSONB),
        'weeks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('week_start', w.week_start, 'kind', w.kind, 'target_tl', w.target_tl,
                                                'focus', w.focus, 'note', w.note, 'day_shape', w.day_shape,
                                                'tl_overridden', w.tl_overridden, 'rationale', w.rationale) ORDER BY w.week_start)
            FROM public.macro_plan_weeks w WHERE w.plan_id = m.id), '[]'::JSONB))
    FROM public.macro_plans m LEFT JOIN public.profiles p ON p.id = m.coach_id
    WHERE m.id = p_plan
$$;
REVOKE ALL ON FUNCTION public.macro_plan_json(UUID) FROM PUBLIC, anon, authenticated;

-- Coach-only extras: disruptions, availability, audit trail and adherence reviews.
CREATE OR REPLACE FUNCTION public.macro_plan_extras_json(p_plan UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'disruptions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'severity', d.severity,
                                      'start_date', d.start_date, 'end_date', d.end_date, 'note', d.note) ORDER BY d.start_date)
                                 FROM public.macro_plan_disruptions d WHERE d.plan_id = p_plan), '[]'::JSONB),
        'availability', COALESCE((SELECT jsonb_agg(jsonb_build_object('week_start', a.week_start, 'availability_pct', a.availability_pct,
                                      'reason', a.reason, 'note', a.note) ORDER BY a.week_start)
                                  FROM public.macro_plan_availability a WHERE a.plan_id = p_plan), '[]'::JSONB),
        'reviews', COALESCE((SELECT jsonb_agg(jsonb_build_object('week_start', r.week_start, 'reason', r.reason, 'status', r.status)
                                      ORDER BY r.week_start)
                              FROM public.macro_plan_reviews r WHERE r.plan_id = p_plan), '[]'::JSONB),
        'audit', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC)
                           FROM (SELECT jsonb_build_object('id', u.id, 'source', u.source, 'option_key', u.option_key, 'summary', u.summary,
                                                           'created_at', u.created_at, 'actor_id', u.actor_id) AS x
                                 FROM public.macro_plan_audit u WHERE u.plan_id = p_plan ORDER BY u.created_at DESC LIMIT 50) q), '[]'::JSONB))
$$;
REVOKE ALL ON FUNCTION public.macro_plan_extras_json(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.macro_plan_get(p_rider UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id UUID;
BEGIN
    PERFORM public.macro_planner_require();
    IF p_rider IS NULL OR NOT public.is_coach_of(p_rider) THEN
        RAISE EXCEPTION 'You are not coaching this rider';
    END IF;
    SELECT id INTO v_id FROM public.macro_plans WHERE coach_id = auth.uid() AND rider_id = p_rider;
    RETURN CASE WHEN v_id IS NULL THEN NULL ELSE public.macro_plan_json(v_id) || public.macro_plan_extras_json(v_id) END;
END;
$$;

-- 5. Save keeps the stored rationale of weeks whose payload does not carry one ------------------
CREATE OR REPLACE FUNCTION public.macro_plan_save(p JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_rider UUID := NULLIF(p->>'rider_id', '')::UUID;
    v_id UUID;
    v_name TEXT := btrim(COALESCE(p->>'race_name', ''));
    v_race DATE := NULLIF(p->>'race_date', '')::DATE;
    v_weeks JSONB := COALESCE(p->'weeks', '[]'::JSONB);
    v_w JSONB;
    v_start DATE;
    v_seen DATE[] := '{}';
    v_first DATE;
    v_old JSONB := '{}'::JSONB;
BEGIN
    PERFORM public.macro_planner_require();
    IF v_rider IS NULL OR NOT public.is_coach_of(v_rider) THEN
        RAISE EXCEPTION 'You are not coaching this rider';
    END IF;
    IF jsonb_typeof(v_weeks) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Weeks must be a list'; END IF;
    IF jsonb_array_length(v_weeks) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'A plan needs 1-60 weeks'; END IF;
    IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Race name must be 1-80 characters'; END IF;
    IF v_race IS NULL THEN RAISE EXCEPTION 'Race date is required'; END IF;

    PERFORM pg_advisory_xact_lock(hashtext('macro_plan:' || v_me::TEXT || v_rider::TEXT));
    SELECT id INTO v_id FROM public.macro_plans WHERE coach_id = v_me AND rider_id = v_rider FOR UPDATE;
    IF v_id IS NULL AND v_race < CURRENT_DATE - 1 THEN
        RAISE EXCEPTION 'The race date must be in the future';
    END IF;

    BEGIN
        IF v_id IS NULL THEN
            INSERT INTO public.macro_plans (coach_id, rider_id, race_name, race_date, race_length, template, build_weeks,
                                            recovery_weeks, ramp_ceiling_pct, start_weekly_tl, baseline_source, goal_ctl)
                VALUES (v_me, v_rider, v_name, v_race, p->>'race_length', p->>'template', (p->>'build_weeks')::INTEGER,
                        (p->>'recovery_weeks')::INTEGER, COALESCE((p->>'ramp_ceiling_pct')::NUMERIC, 7),
                        (p->>'start_weekly_tl')::NUMERIC, p->>'baseline_source', NULLIF(p->>'goal_ctl', '')::NUMERIC)
                RETURNING id INTO v_id;
        ELSE
            UPDATE public.macro_plans
                SET race_name = v_name, race_date = v_race, race_length = p->>'race_length', template = p->>'template',
                    build_weeks = (p->>'build_weeks')::INTEGER, recovery_weeks = (p->>'recovery_weeks')::INTEGER,
                    ramp_ceiling_pct = COALESCE((p->>'ramp_ceiling_pct')::NUMERIC, 7),
                    start_weekly_tl = (p->>'start_weekly_tl')::NUMERIC, baseline_source = p->>'baseline_source',
                    goal_ctl = NULLIF(p->>'goal_ctl', '')::NUMERIC, updated_at = NOW()
                WHERE id = v_id;
            SELECT COALESCE(jsonb_object_agg(week_start::TEXT, rationale), '{}'::JSONB) INTO v_old
                FROM public.macro_plan_weeks WHERE plan_id = v_id;
            DELETE FROM public.macro_plan_weeks WHERE plan_id = v_id;
        END IF;

        FOR v_w IN SELECT * FROM jsonb_array_elements(v_weeks) LOOP
            v_start := NULLIF(v_w->>'week_start', '')::DATE;
            IF v_start IS NULL OR v_start = ANY (v_seen) THEN RAISE EXCEPTION 'Invalid or duplicate week'; END IF;
            v_seen := v_seen || v_start;
            IF v_start > v_race THEN RAISE EXCEPTION 'A week starts after the race'; END IF;
            INSERT INTO public.macro_plan_weeks (plan_id, week_start, kind, target_tl, focus, note, day_shape, tl_overridden, rationale)
                VALUES (v_id, v_start, v_w->>'kind', (v_w->>'target_tl')::NUMERIC, btrim(COALESCE(v_w->>'focus', '')),
                        btrim(COALESCE(v_w->>'note', '')), COALESCE(NULLIF(v_w->>'day_shape', ''), 'REHEHEE'),
                        COALESCE((v_w->>'tl_overridden')::BOOLEAN, FALSE),
                        btrim(COALESCE(v_w->>'rationale', v_old->>(v_start::TEXT), '')));
        END LOOP;
    EXCEPTION
        WHEN check_violation OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
             OR numeric_value_out_of_range OR not_null_violation THEN
            RAISE EXCEPTION 'Invalid plan values';
    END;

    SELECT min(week_start) INTO v_first FROM public.macro_plan_weeks WHERE plan_id = v_id;
    IF v_first IS NULL OR v_race - v_first > 7 * 60 THEN RAISE EXCEPTION 'The plan spans too many weeks'; END IF;
    RETURN v_id;
END;
$$;

-- Athlete, read only. Same as before, minus everything the coach has not chosen to share: rationale only with
-- share_reasoning on; disruptions, availability, reviews and audit are never part of it.
CREATE OR REPLACE FUNCTION public.my_macro_plan()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id UUID;
    v_json JSONB;
BEGIN
    IF auth.uid() IS NULL THEN RETURN NULL; END IF;
    SELECT m.id INTO v_id
    FROM public.macro_plans m
    WHERE m.rider_id = auth.uid() AND m.status = 'published'
      AND public.macro_planner_enabled(m.coach_id)
      AND EXISTS (SELECT 1 FROM public.coaching_relationships c
                  WHERE c.coach_id = m.coach_id AND c.rider_id = m.rider_id AND c.status = 'active'
                    AND NOT public.is_blocked_between(c.coach_id, c.rider_id))
    LIMIT 1;
    IF v_id IS NULL THEN RETURN NULL; END IF;
    v_json := public.macro_plan_json(v_id);
    IF NOT COALESCE((v_json->>'share_reasoning')::BOOLEAN, FALSE) THEN
        v_json := (v_json - 'plan_rationale') || jsonb_build_object('weeks', COALESCE((
            SELECT jsonb_agg(w - 'rationale' ORDER BY ord) FROM jsonb_array_elements(v_json->'weeks') WITH ORDINALITY AS t(w, ord)), '[]'::JSONB));
    END IF;
    RETURN v_json;
END;
$$;

-- 6. Coach RPCs -----------------------------------------------------------------------------
-- p: {id?, kind, severity, start_date, end_date?, note?}. Returns the disruption id.
CREATE OR REPLACE FUNCTION public.macro_plan_disruption_save(p_plan UUID, p JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id UUID := NULLIF(p->>'id', '')::UUID;
BEGIN
    PERFORM public.macro_plan_authorize(p_plan);
    PERFORM pg_advisory_xact_lock(hashtext('macro_plan_disruption:' || p_plan::TEXT));
    BEGIN
        IF v_id IS NULL THEN
            IF (SELECT count(*) FROM public.macro_plan_disruptions WHERE plan_id = p_plan) >= 30 THEN
                RAISE EXCEPTION 'Too many disruptions on this plan';
            END IF;
            INSERT INTO public.macro_plan_disruptions (plan_id, kind, severity, start_date, end_date, note)
                VALUES (p_plan, p->>'kind', p->>'severity', (p->>'start_date')::DATE, NULLIF(p->>'end_date', '')::DATE, btrim(COALESCE(p->>'note', '')))
                RETURNING id INTO v_id;
        ELSE
            UPDATE public.macro_plan_disruptions
                SET kind = p->>'kind', severity = p->>'severity', start_date = (p->>'start_date')::DATE,
                    end_date = NULLIF(p->>'end_date', '')::DATE, note = btrim(COALESCE(p->>'note', '')), updated_at = NOW()
                WHERE id = v_id AND plan_id = p_plan;
            IF NOT FOUND THEN RAISE EXCEPTION 'No such disruption'; END IF;
        END IF;
    EXCEPTION
        WHEN check_violation OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
             OR not_null_violation THEN
            RAISE EXCEPTION 'Invalid disruption values';
    END;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.macro_plan_disruption_delete(p_plan UUID, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.macro_plan_authorize(p_plan);
    DELETE FROM public.macro_plan_disruptions WHERE id = p_id AND plan_id = p_plan;
    IF NOT FOUND THEN RAISE EXCEPTION 'No such disruption'; END IF;
END;
$$;

-- p: [{name, race_date, priority}] replaces the B/C races of the plan. Races must be before the A race.
CREATE OR REPLACE FUNCTION public.macro_plan_races_set(p_plan UUID, p JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_race DATE;
    v_r JSONB;
BEGIN
    PERFORM public.macro_plan_authorize(p_plan);
    IF jsonb_typeof(p) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Races must be a list'; END IF;
    IF jsonb_array_length(p) > 20 THEN RAISE EXCEPTION 'At most 20 B/C races'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('macro_plan_races:' || p_plan::TEXT));
    SELECT race_date INTO v_race FROM public.macro_plans WHERE id = p_plan;
    BEGIN
        DELETE FROM public.macro_plan_races WHERE plan_id = p_plan;
        FOR v_r IN SELECT * FROM jsonb_array_elements(p) LOOP
            IF (v_r->>'race_date')::DATE >= v_race THEN RAISE EXCEPTION 'B/C races must be before the A race'; END IF;
            INSERT INTO public.macro_plan_races (plan_id, name, race_date, priority)
                VALUES (p_plan, btrim(COALESCE(v_r->>'name', '')), (v_r->>'race_date')::DATE, v_r->>'priority');
        END LOOP;
    EXCEPTION
        WHEN check_violation OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
             OR not_null_violation THEN
            RAISE EXCEPTION 'Invalid race values';
    END;
END;
$$;

-- p: [{week_start, availability_pct, reason, note?}] replaces the reduced-availability weeks of the plan.
CREATE OR REPLACE FUNCTION public.macro_plan_availability_set(p_plan UUID, p JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_a JSONB;
BEGIN
    PERFORM public.macro_plan_authorize(p_plan);
    IF jsonb_typeof(p) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Availability must be a list'; END IF;
    IF jsonb_array_length(p) > 60 THEN RAISE EXCEPTION 'At most 60 weeks'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('macro_plan_availability:' || p_plan::TEXT));
    BEGIN
        DELETE FROM public.macro_plan_availability WHERE plan_id = p_plan;
        FOR v_a IN SELECT * FROM jsonb_array_elements(p) LOOP
            INSERT INTO public.macro_plan_availability (plan_id, week_start, availability_pct, reason, note)
                VALUES (p_plan, (v_a->>'week_start')::DATE, (v_a->>'availability_pct')::INTEGER, v_a->>'reason', btrim(COALESCE(v_a->>'note', '')));
        END LOOP;
    EXCEPTION
        WHEN check_violation OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
             OR unique_violation OR not_null_violation THEN
            RAISE EXCEPTION 'Invalid availability values';
    END;
END;
$$;

-- Open / dismiss / complete the adherence review of a week (the app proposes it when adherence drifts).
CREATE OR REPLACE FUNCTION public.macro_plan_review_set(p_plan UUID, p_week DATE, p_reason TEXT, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.macro_plan_authorize(p_plan);
    BEGIN
        INSERT INTO public.macro_plan_reviews (plan_id, week_start, reason, status)
            VALUES (p_plan, p_week, btrim(COALESCE(p_reason, '')), p_status)
            ON CONFLICT (plan_id, week_start) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
                WHERE macro_plan_reviews.status <> EXCLUDED.status;
    EXCEPTION
        WHEN check_violation OR not_null_violation THEN
            RAISE EXCEPTION 'Invalid review values';
    END;
END;
$$;

-- Sharing: whether the athlete sees the per-week rationale and the plan rationale (default off).
CREATE OR REPLACE FUNCTION public.macro_plan_share_set(p_plan UUID, p_share BOOLEAN, p_rationale TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.macro_plan_authorize(p_plan);
    IF char_length(COALESCE(p_rationale, '')) > 1000 THEN RAISE EXCEPTION 'The rationale is too long'; END IF;
    UPDATE public.macro_plans SET share_reasoning = COALESCE(p_share, FALSE), plan_rationale = btrim(COALESCE(p_rationale, '')),
                                  updated_at = NOW() WHERE id = p_plan;
END;
$$;

-- Applies a suggestion the coach approved: replaces the weeks (and optionally the goal CTL) and writes the audit row in one
-- transaction. p: {source, option, summary, weeks: [...], goal_ctl?, disruption_id?}. Nothing else changes a plan silently.
CREATE OR REPLACE FUNCTION public.macro_plan_apply(p_plan UUID, p JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_race DATE;
    v_weeks JSONB := COALESCE(p->'weeks', '[]'::JSONB);
    v_w JSONB;
    v_start DATE;
    v_seen DATE[] := '{}';
    v_old JSONB := '{}'::JSONB;
    v_before JSONB;
    v_after JSONB;
    v_goal_before NUMERIC;
    v_goal_after NUMERIC;
    v_audit UUID;
BEGIN
    PERFORM public.macro_plan_authorize(p_plan);
    IF jsonb_typeof(v_weeks) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Weeks must be a list'; END IF;
    IF jsonb_array_length(v_weeks) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'A plan needs 1-60 weeks'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('macro_plan_apply:' || p_plan::TEXT));
    SELECT race_date, goal_ctl INTO v_race, v_goal_before FROM public.macro_plans WHERE id = p_plan FOR UPDATE;
    v_goal_after := CASE WHEN p ? 'goal_ctl' THEN NULLIF(p->>'goal_ctl', '')::NUMERIC ELSE v_goal_before END;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('week_start', week_start, 'kind', kind, 'target_tl', target_tl) ORDER BY week_start), '[]'::JSONB),
           COALESCE(jsonb_object_agg(week_start::TEXT, rationale), '{}'::JSONB)
        INTO v_before, v_old FROM public.macro_plan_weeks WHERE plan_id = p_plan;

    BEGIN
        DELETE FROM public.macro_plan_weeks WHERE plan_id = p_plan;
        FOR v_w IN SELECT * FROM jsonb_array_elements(v_weeks) LOOP
            v_start := NULLIF(v_w->>'week_start', '')::DATE;
            IF v_start IS NULL OR v_start = ANY (v_seen) THEN RAISE EXCEPTION 'Invalid or duplicate week'; END IF;
            v_seen := v_seen || v_start;
            IF v_start > v_race THEN RAISE EXCEPTION 'A week starts after the race'; END IF;
            INSERT INTO public.macro_plan_weeks (plan_id, week_start, kind, target_tl, focus, note, day_shape, tl_overridden, rationale)
                VALUES (p_plan, v_start, v_w->>'kind', (v_w->>'target_tl')::NUMERIC, btrim(COALESCE(v_w->>'focus', '')),
                        btrim(COALESCE(v_w->>'note', '')), COALESCE(NULLIF(v_w->>'day_shape', ''), 'REHEHEE'),
                        COALESCE((v_w->>'tl_overridden')::BOOLEAN, FALSE),
                        btrim(COALESCE(v_w->>'rationale', v_old->>(v_start::TEXT), '')));
        END LOOP;
        UPDATE public.macro_plans SET goal_ctl = v_goal_after, updated_at = NOW() WHERE id = p_plan;
        SELECT COALESCE(jsonb_agg(jsonb_build_object('week_start', week_start, 'kind', kind, 'target_tl', target_tl) ORDER BY week_start), '[]'::JSONB)
            INTO v_after FROM public.macro_plan_weeks WHERE plan_id = p_plan;
        INSERT INTO public.macro_plan_audit (plan_id, actor_id, source, option_key, summary, details)
            VALUES (p_plan, auth.uid(), p->>'source', btrim(COALESCE(p->>'option', '')), btrim(COALESCE(p->>'summary', '')),
                    jsonb_build_object('before', v_before, 'after', v_after, 'goal_before', v_goal_before, 'goal_after', v_goal_after,
                                       'disruption_id', NULLIF(p->>'disruption_id', '')))
            RETURNING id INTO v_audit;
    EXCEPTION
        WHEN check_violation OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
             OR numeric_value_out_of_range OR not_null_violation THEN
            RAISE EXCEPTION 'Invalid plan values';
    END;
    IF (SELECT min(week_start) FROM public.macro_plan_weeks WHERE plan_id = p_plan) < v_race - 7 * 60 THEN
        RAISE EXCEPTION 'The plan spans too many weeks';
    END IF;
    RETURN v_audit;
END;
$$;

REVOKE ALL ON FUNCTION public.macro_plan_get(UUID), public.macro_plan_save(JSONB), public.my_macro_plan(),
    public.macro_plan_disruption_save(UUID, JSONB), public.macro_plan_disruption_delete(UUID, UUID),
    public.macro_plan_races_set(UUID, JSONB), public.macro_plan_availability_set(UUID, JSONB),
    public.macro_plan_review_set(UUID, DATE, TEXT, TEXT), public.macro_plan_share_set(UUID, BOOLEAN, TEXT),
    public.macro_plan_apply(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.macro_plan_get(UUID), public.macro_plan_save(JSONB), public.my_macro_plan(),
    public.macro_plan_disruption_save(UUID, JSONB), public.macro_plan_disruption_delete(UUID, UUID),
    public.macro_plan_races_set(UUID, JSONB), public.macro_plan_availability_set(UUID, JSONB),
    public.macro_plan_review_set(UUID, DATE, TEXT, TEXT), public.macro_plan_share_set(UUID, BOOLEAN, TEXT),
    public.macro_plan_apply(UUID, JSONB) TO authenticated;
