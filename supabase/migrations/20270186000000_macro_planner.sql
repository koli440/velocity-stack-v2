-- Coach macro planner v1 (docs/macro-planner.md): feature flag `macro_planner` (default OFF), plans and planned weeks.
-- Dark: with the flag off every coach RPC refuses and the athlete RPC returns nothing; no existing object is changed.
--
-- Flag: same mechanism as coach_module (settings row + allow-list, enforced inside every RPC, UI only mirrors it).
-- Data: macro_plans (one per coach + athlete) and macro_plan_weeks. No client table privileges; all access through
-- SECURITY DEFINER RPCs that call macro_planner_require() and is_coach_of(rider) and stamp the coach from auth.uid().
-- All objects are additive and idempotent.

-- 1. Flag ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.macro_planner_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    global_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.macro_planner_settings (id, global_enabled) VALUES (TRUE, FALSE) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.macro_planner_allowlist (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.macro_planner_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.macro_planner_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.macro_planner_settings, public.macro_planner_allowlist FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.macro_planner_enabled(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((SELECT global_enabled FROM public.macro_planner_settings WHERE id), FALSE)
        OR (p_user IS NOT NULL AND EXISTS (SELECT 1 FROM public.macro_planner_allowlist WHERE user_id = p_user))
$$;
REVOKE ALL ON FUNCTION public.macro_planner_enabled(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.macro_planner_require()
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT public.macro_planner_enabled(auth.uid()) THEN
        RAISE EXCEPTION 'Macro planner is not enabled';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.macro_planner_require() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_macro_planner_enabled()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT auth.uid() IS NOT NULL AND public.macro_planner_enabled(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.my_macro_planner_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_macro_planner_enabled() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_macro_planner_status()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin only';
    END IF;
    RETURN jsonb_build_object(
        'global_enabled', COALESCE((SELECT global_enabled FROM public.macro_planner_settings WHERE id), FALSE),
        'allowlist', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('user_id', a.user_id, 'display_name', public.profile_display_name(p.nickname, p.first_name, p.last_name), 'added_at', a.added_at)
                             ORDER BY a.added_at)
            FROM public.macro_planner_allowlist a LEFT JOIN public.profiles p ON p.id = a.user_id), '[]'::jsonb)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_macro_planner_global(p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin only';
    END IF;
    UPDATE public.macro_planner_settings SET global_enabled = COALESCE(p_enabled, FALSE), updated_at = NOW() WHERE id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_macro_planner_allow(p_user UUID, p_allowed BOOLEAN)
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
        INSERT INTO public.macro_planner_allowlist (user_id, added_by) VALUES (p_user, auth.uid())
            ON CONFLICT (user_id) DO NOTHING;
    ELSE
        DELETE FROM public.macro_planner_allowlist WHERE user_id = p_user;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_macro_planner_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_macro_planner_global(BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_macro_planner_allow(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_macro_planner_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_macro_planner_global(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_macro_planner_allow(UUID, BOOLEAN) TO authenticated;

-- 2. Tables --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.macro_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    race_name TEXT NOT NULL,
    race_date DATE NOT NULL,
    race_length TEXT NOT NULL,
    template TEXT NOT NULL,
    build_weeks INTEGER NOT NULL,
    recovery_weeks INTEGER NOT NULL,
    ramp_ceiling_pct NUMERIC(4, 1) NOT NULL DEFAULT 7,
    start_weekly_tl NUMERIC(7, 1) NOT NULL,
    baseline_source TEXT NOT NULL,
    goal_ctl NUMERIC(5, 1),
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT macro_plans_pair UNIQUE (coach_id, rider_id),
    CHECK (coach_id <> rider_id),
    CONSTRAINT macro_plans_name_len CHECK (char_length(race_name) BETWEEN 1 AND 80),
    CONSTRAINT macro_plans_race_date CHECK (race_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
    CONSTRAINT macro_plans_race_length CHECK (race_length IN ('short', 'medium', 'long', 'ultra')),
    CONSTRAINT macro_plans_template CHECK (template IN ('3+1', '2+1', '4+1', 'custom')),
    CONSTRAINT macro_plans_build_weeks CHECK (build_weeks BETWEEN 1 AND 8),
    CONSTRAINT macro_plans_recovery_weeks CHECK (recovery_weeks BETWEEN 1 AND 3),
    CONSTRAINT macro_plans_ramp CHECK (ramp_ceiling_pct BETWEEN 0 AND 15),
    CONSTRAINT macro_plans_start_tl CHECK (start_weekly_tl BETWEEN 0 AND 5000),
    CONSTRAINT macro_plans_source CHECK (baseline_source IN ('history', 'manual')),
    CONSTRAINT macro_plans_goal CHECK (goal_ctl IS NULL OR goal_ctl BETWEEN 0 AND 300),
    CONSTRAINT macro_plans_status CHECK (status IN ('draft', 'published'))
);
CREATE INDEX IF NOT EXISTS idx_macro_plans_rider ON public.macro_plans (rider_id) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS public.macro_plan_weeks (
    plan_id UUID NOT NULL REFERENCES public.macro_plans(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    kind TEXT NOT NULL,
    target_tl NUMERIC(7, 1) NOT NULL,
    focus TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    day_shape TEXT NOT NULL DEFAULT 'REHEHEE',
    tl_overridden BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (plan_id, week_start),
    CONSTRAINT macro_plan_weeks_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1),
    CONSTRAINT macro_plan_weeks_kind CHECK (kind IN ('build', 'recovery', 'taper')),
    CONSTRAINT macro_plan_weeks_tl CHECK (target_tl BETWEEN 0 AND 5000),
    CONSTRAINT macro_plan_weeks_focus_len CHECK (char_length(focus) <= 40),
    CONSTRAINT macro_plan_weeks_note_len CHECK (char_length(note) <= 500),
    CONSTRAINT macro_plan_weeks_shape CHECK (day_shape ~ '^[HER]{7}$')
);

ALTER TABLE public.macro_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.macro_plan_weeks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.macro_plans, public.macro_plan_weeks FROM PUBLIC, anon, authenticated;

-- 3. RPCs ----------------------------------------------------------------------------------
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
        'weeks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('week_start', w.week_start, 'kind', w.kind, 'target_tl', w.target_tl,
                                                'focus', w.focus, 'note', w.note, 'day_shape', w.day_shape,
                                                'tl_overridden', w.tl_overridden) ORDER BY w.week_start)
            FROM public.macro_plan_weeks w WHERE w.plan_id = m.id), '[]'::JSONB))
    FROM public.macro_plans m LEFT JOIN public.profiles p ON p.id = m.coach_id
    WHERE m.id = p_plan
$$;
REVOKE ALL ON FUNCTION public.macro_plan_json(UUID) FROM PUBLIC, anon, authenticated;

-- The coach's plan for an active athlete (NULL when there is none).
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
    RETURN CASE WHEN v_id IS NULL THEN NULL ELSE public.macro_plan_json(v_id) END;
END;
$$;

-- p: {rider_id, race_name, race_date, race_length, template, build_weeks, recovery_weeks, ramp_ceiling_pct,
--     start_weekly_tl, baseline_source, goal_ctl?, weeks: [{week_start, kind, target_tl, focus?, note?, day_shape?, tl_overridden?}]}
-- Creates the plan or replaces it (and all of its weeks) in one transaction. Status is kept; a new plan is a draft.
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
            DELETE FROM public.macro_plan_weeks WHERE plan_id = v_id;
        END IF;

        FOR v_w IN SELECT * FROM jsonb_array_elements(v_weeks) LOOP
            v_start := NULLIF(v_w->>'week_start', '')::DATE;
            IF v_start IS NULL OR v_start = ANY (v_seen) THEN RAISE EXCEPTION 'Invalid or duplicate week'; END IF;
            v_seen := v_seen || v_start;
            IF v_start > v_race THEN RAISE EXCEPTION 'A week starts after the race'; END IF;
            INSERT INTO public.macro_plan_weeks (plan_id, week_start, kind, target_tl, focus, note, day_shape, tl_overridden)
                VALUES (v_id, v_start, v_w->>'kind', (v_w->>'target_tl')::NUMERIC, btrim(COALESCE(v_w->>'focus', '')),
                        btrim(COALESCE(v_w->>'note', '')), COALESCE(NULLIF(v_w->>'day_shape', ''), 'REHEHEE'),
                        COALESCE((v_w->>'tl_overridden')::BOOLEAN, FALSE));
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

CREATE OR REPLACE FUNCTION public.macro_plan_publish(p_plan UUID, p_published BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_rider UUID;
BEGIN
    PERFORM public.macro_planner_require();
    SELECT rider_id INTO v_rider FROM public.macro_plans WHERE id = p_plan AND coach_id = auth.uid() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No such plan'; END IF;
    IF NOT public.is_coach_of(v_rider) THEN RAISE EXCEPTION 'You are not coaching this rider'; END IF;
    UPDATE public.macro_plans SET status = CASE WHEN COALESCE(p_published, FALSE) THEN 'published' ELSE 'draft' END,
                                  updated_at = NOW() WHERE id = p_plan;
END;
$$;

CREATE OR REPLACE FUNCTION public.macro_plan_delete(p_plan UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_rider UUID;
BEGIN
    PERFORM public.macro_planner_require();
    SELECT rider_id INTO v_rider FROM public.macro_plans WHERE id = p_plan AND coach_id = auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'No such plan'; END IF;
    IF NOT public.is_coach_of(v_rider) THEN RAISE EXCEPTION 'You are not coaching this rider'; END IF;
    DELETE FROM public.macro_plans WHERE id = p_plan;
END;
$$;

-- Athlete, read only: the PUBLISHED plan of the rider's ACTIVE coach while that coach has the flag. NULL otherwise
-- (never raises, so the menu can probe it).
CREATE OR REPLACE FUNCTION public.my_macro_plan()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id UUID;
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
    RETURN CASE WHEN v_id IS NULL THEN NULL ELSE public.macro_plan_json(v_id) END;
END;
$$;

REVOKE ALL ON FUNCTION public.macro_plan_get(UUID), public.macro_plan_save(JSONB), public.macro_plan_publish(UUID, BOOLEAN),
    public.macro_plan_delete(UUID), public.my_macro_plan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.macro_plan_get(UUID), public.macro_plan_save(JSONB), public.macro_plan_publish(UUID, BOOLEAN),
    public.macro_plan_delete(UUID), public.my_macro_plan() TO authenticated;
