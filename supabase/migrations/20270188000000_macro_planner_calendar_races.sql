-- Macro planner: races come from the athlete's CALENDAR (docs/macro-planner.md, "Races come from the calendar").
-- The planner no longer has free-form race entry: the A race and the B/C races are existing calendar_races rows of the
-- athlete, selected by the coach (who may add races on the athlete's calendar under the existing coach permissions).
-- Name and date come from the calendar entry and follow it: renaming or moving the race updates the plan (a move also
-- flags the plan 'race_moved' so the coach re-checks the weeks); deleting a linked race flags the plan ('race_deleted',
-- B/C: the race is marked missing) instead of silently dropping it.
-- Additive and idempotent. Dark: with the flag off no plan exists, so the new triggers on calendar_races update nothing,
-- and they swallow any error so the calendar can never be broken by them.

-- 1. Columns -----------------------------------------------------------------------------------
ALTER TABLE public.macro_plans ADD COLUMN IF NOT EXISTS race_id UUID REFERENCES public.calendar_races(id) ON DELETE SET NULL;
ALTER TABLE public.macro_plans ADD COLUMN IF NOT EXISTS attention TEXT
    CHECK (attention IN ('race_unlinked', 'race_deleted', 'race_moved'));
ALTER TABLE public.macro_plan_races ADD COLUMN IF NOT EXISTS race_id UUID REFERENCES public.calendar_races(id) ON DELETE SET NULL;
ALTER TABLE public.macro_plan_races ADD COLUMN IF NOT EXISTS missing BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_macro_plans_race ON public.macro_plans (race_id) WHERE race_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_macro_plan_races_race ON public.macro_plan_races (plan_id, race_id) WHERE race_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_macro_plan_races_race ON public.macro_plan_races (race_id) WHERE race_id IS NOT NULL;

-- 2. Backfill: link existing free-form entries to a matching calendar race, otherwise ask the coach to pick one --------
UPDATE public.macro_plans m SET race_id = c.id
    FROM public.calendar_races c
    WHERE m.race_id IS NULL AND m.attention IS NULL AND c.rider_id = m.rider_id AND c.race_date = m.race_date
      AND lower(c.name) = lower(m.race_name);
UPDATE public.macro_plans SET attention = 'race_unlinked' WHERE race_id IS NULL AND attention IS NULL;

UPDATE public.macro_plan_races r SET race_id = c.id
    FROM public.macro_plans m, public.calendar_races c
    WHERE r.race_id IS NULL AND NOT r.missing AND m.id = r.plan_id AND c.rider_id = m.rider_id AND c.race_date = r.race_date
      AND lower(c.name) = lower(r.name)
      AND NOT EXISTS (SELECT 1 FROM public.macro_plan_races o WHERE o.plan_id = r.plan_id AND o.race_id = c.id);
UPDATE public.macro_plan_races SET missing = TRUE WHERE race_id IS NULL AND NOT missing;

-- 3. Follow the calendar -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.macro_planner_calendar_race_changed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    BEGIN
        UPDATE public.macro_plans
            SET race_name = NEW.name, race_date = NEW.race_date, updated_at = NOW(),
                attention = CASE WHEN OLD.race_date IS DISTINCT FROM NEW.race_date THEN 'race_moved' ELSE attention END
            WHERE race_id = NEW.id;
        UPDATE public.macro_plan_races SET name = NEW.name, race_date = NEW.race_date WHERE race_id = NEW.id;
        IF OLD.race_date IS DISTINCT FROM NEW.race_date THEN
            UPDATE public.macro_plans SET attention = 'race_moved', updated_at = NOW()
                WHERE attention IS NULL AND id IN (SELECT plan_id FROM public.macro_plan_races WHERE race_id = NEW.id);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'macro planner calendar sync failed: %', SQLERRM;
    END;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.macro_planner_calendar_race_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    BEGIN
        UPDATE public.macro_plans SET attention = 'race_deleted', updated_at = NOW() WHERE race_id = OLD.id;
        UPDATE public.macro_plan_races SET missing = TRUE WHERE race_id = OLD.id;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'macro planner calendar sync failed: %', SQLERRM;
    END;
    RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.macro_planner_calendar_race_changed(), public.macro_planner_calendar_race_deleted()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_macro_planner_calendar_race_changed ON public.calendar_races;
CREATE TRIGGER trg_macro_planner_calendar_race_changed
    AFTER UPDATE OF name, race_date ON public.calendar_races
    FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.race_date IS DISTINCT FROM NEW.race_date)
    EXECUTE FUNCTION public.macro_planner_calendar_race_changed();

DROP TRIGGER IF EXISTS trg_macro_planner_calendar_race_deleted ON public.calendar_races;
CREATE TRIGGER trg_macro_planner_calendar_race_deleted
    BEFORE DELETE ON public.calendar_races
    FOR EACH ROW EXECUTE FUNCTION public.macro_planner_calendar_race_deleted();

-- 4. Plan JSON: race link, attention flag (coach only: stripped for the athlete) -----------------------------
CREATE OR REPLACE FUNCTION public.macro_plan_json(p_plan UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'id', m.id, 'coach_id', m.coach_id, 'rider_id', m.rider_id,
        'coach_name', public.profile_display_name(p.nickname, p.first_name, p.last_name),
        'race_id', m.race_id, 'race_name', m.race_name, 'race_date', m.race_date, 'race_length', m.race_length,
        'attention', COALESCE(m.attention, CASE WHEN EXISTS (SELECT 1 FROM public.macro_plan_races x WHERE x.plan_id = m.id AND x.missing)
                                                THEN 'minor_race_deleted' END),
        'template', m.template, 'build_weeks', m.build_weeks, 'recovery_weeks', m.recovery_weeks,
        'ramp_ceiling_pct', m.ramp_ceiling_pct, 'start_weekly_tl', m.start_weekly_tl,
        'baseline_source', m.baseline_source, 'goal_ctl', m.goal_ctl, 'status', m.status,
        'updated_at', m.updated_at,
        'share_reasoning', m.share_reasoning, 'plan_rationale', m.plan_rationale,
        'races', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'race_id', r.race_id, 'missing', r.missing, 'name', r.name,
                                                               'race_date', r.race_date, 'priority', r.priority)
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

-- Athlete: no attention flag, no race ids, no race that disappeared from the calendar.
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
    v_json := public.macro_plan_json(v_id) - 'attention' - 'race_id';
    v_json := v_json || jsonb_build_object('races', COALESCE((
        SELECT jsonb_agg(r - 'race_id' - 'missing' ORDER BY ord) FROM jsonb_array_elements(v_json->'races') WITH ORDINALITY AS t(r, ord)
        WHERE NOT (r->>'missing')::BOOLEAN), '[]'::JSONB));
    IF NOT COALESCE((v_json->>'share_reasoning')::BOOLEAN, FALSE) THEN
        v_json := (v_json - 'plan_rationale') || jsonb_build_object('weeks', COALESCE((
            SELECT jsonb_agg(w - 'rationale' ORDER BY ord) FROM jsonb_array_elements(v_json->'weeks') WITH ORDINALITY AS t(w, ord)), '[]'::JSONB));
    END IF;
    RETURN v_json;
END;
$$;

-- 5. Save: the A race is a calendar race of the athlete; name and date come from the calendar ---------------
-- p.race_id selects it (kept from the stored plan when absent); race_name / race_date in the payload are ignored.
CREATE OR REPLACE FUNCTION public.macro_plan_save(p JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_rider UUID := NULLIF(p->>'rider_id', '')::UUID;
    v_id UUID;
    v_cal UUID;
    v_prev UUID;
    v_attn TEXT;
    v_name TEXT;
    v_race DATE;
    v_weeks JSONB := COALESCE(p->'weeks', '[]'::JSONB);
    v_w JSONB;
    v_start DATE;
    v_seen DATE[] := '{}';
    v_first DATE;
    v_last DATE;
    v_old JSONB := '{}'::JSONB;
BEGIN
    PERFORM public.macro_planner_require();
    IF v_rider IS NULL OR NOT public.is_coach_of(v_rider) THEN
        RAISE EXCEPTION 'You are not coaching this rider';
    END IF;
    IF jsonb_typeof(v_weeks) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Weeks must be a list'; END IF;
    IF jsonb_array_length(v_weeks) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'A plan needs 1-60 weeks'; END IF;

    PERFORM pg_advisory_xact_lock(hashtext('macro_plan:' || v_me::TEXT || v_rider::TEXT));
    SELECT id, race_id, attention INTO v_id, v_prev, v_attn FROM public.macro_plans WHERE coach_id = v_me AND rider_id = v_rider FOR UPDATE;

    BEGIN
        v_cal := COALESCE(NULLIF(p->>'race_id', '')::UUID, v_prev);
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Select the race from the athlete''s calendar';
    END;
    IF v_cal IS NULL THEN RAISE EXCEPTION 'Select the race from the athlete''s calendar'; END IF;
    SELECT c.name, c.race_date INTO v_name, v_race FROM public.calendar_races c WHERE c.id = v_cal AND c.rider_id = v_rider;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Race not found in the athlete''s calendar'; END IF;
    IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.macro_plan_races WHERE plan_id = v_id AND race_id = v_cal) THEN
        RAISE EXCEPTION 'That race is already a B/C race of this plan';
    END IF;
    IF v_id IS NULL AND v_race < CURRENT_DATE - 1 THEN
        RAISE EXCEPTION 'The race date must be in the future';
    END IF;

    BEGIN
        IF v_id IS NULL THEN
            INSERT INTO public.macro_plans (coach_id, rider_id, race_id, race_name, race_date, race_length, template, build_weeks,
                                            recovery_weeks, ramp_ceiling_pct, start_weekly_tl, baseline_source, goal_ctl)
                VALUES (v_me, v_rider, v_cal, v_name, v_race, p->>'race_length', p->>'template', (p->>'build_weeks')::INTEGER,
                        (p->>'recovery_weeks')::INTEGER, COALESCE((p->>'ramp_ceiling_pct')::NUMERIC, 7),
                        (p->>'start_weekly_tl')::NUMERIC, p->>'baseline_source', NULLIF(p->>'goal_ctl', '')::NUMERIC)
                RETURNING id INTO v_id;
        ELSE
            UPDATE public.macro_plans
                SET race_id = v_cal, race_name = v_name, race_date = v_race, race_length = p->>'race_length', template = p->>'template',
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

    SELECT min(week_start), max(week_start) INTO v_first, v_last FROM public.macro_plan_weeks WHERE plan_id = v_id;
    IF v_first IS NULL OR v_race - v_first > 7 * 60 THEN RAISE EXCEPTION 'The plan spans too many weeks'; END IF;
    -- A flagged plan (or a switched race) is clear again once its last week is the race week of the current race date.
    IF v_attn IS NOT NULL OR (v_prev IS NOT NULL AND v_prev <> v_cal) THEN
        UPDATE public.macro_plans
            SET attention = CASE WHEN v_last = v_race - (EXTRACT(ISODOW FROM v_race)::INTEGER - 1) THEN NULL ELSE 'race_moved' END
            WHERE id = v_id;
    END IF;
    RETURN v_id;
END;
$$;

-- 6. B/C races: p = [{race_id, priority}] replaces the set; name and date come from the calendar -------------
CREATE OR REPLACE FUNCTION public.macro_plan_races_set(p_plan UUID, p JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_race DATE;
    v_rider UUID;
    v_a UUID;
    v_r JSONB;
    v_cal UUID;
    v_name TEXT;
    v_date DATE;
BEGIN
    PERFORM public.macro_plan_authorize(p_plan);
    IF jsonb_typeof(p) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Races must be a list'; END IF;
    IF jsonb_array_length(p) > 20 THEN RAISE EXCEPTION 'At most 20 B/C races'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('macro_plan_races:' || p_plan::TEXT));
    SELECT race_date, rider_id, race_id INTO v_race, v_rider, v_a FROM public.macro_plans WHERE id = p_plan;
    BEGIN
        DELETE FROM public.macro_plan_races WHERE plan_id = p_plan;
        FOR v_r IN SELECT * FROM jsonb_array_elements(p) LOOP
            v_cal := NULLIF(v_r->>'race_id', '')::UUID;
            IF v_cal IS NULL THEN RAISE EXCEPTION 'Select the race from the athlete''s calendar'; END IF;
            IF v_cal = v_a THEN RAISE EXCEPTION 'That race is the A race of this plan'; END IF;
            SELECT c.name, c.race_date INTO v_name, v_date FROM public.calendar_races c WHERE c.id = v_cal AND c.rider_id = v_rider;
            IF v_name IS NULL THEN RAISE EXCEPTION 'Race not found in the athlete''s calendar'; END IF;
            IF v_date >= v_race THEN RAISE EXCEPTION 'B/C races must be before the A race'; END IF;
            INSERT INTO public.macro_plan_races (plan_id, race_id, name, race_date, priority)
                VALUES (p_plan, v_cal, v_name, v_date, v_r->>'priority');
        END LOOP;
    EXCEPTION
        WHEN check_violation OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
             OR not_null_violation OR unique_violation THEN
            RAISE EXCEPTION 'Invalid race values';
    END;
END;
$$;

-- Coach confirms the weeks fit the (moved) race. Needs a linked A race; a missing B/C race has to be removed instead.
CREATE OR REPLACE FUNCTION public.macro_plan_attention_ack(p_plan UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.macro_plan_authorize(p_plan);
    UPDATE public.macro_plans SET attention = NULL, updated_at = NOW()
        WHERE id = p_plan AND attention = 'race_moved' AND race_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.macro_plan_save(JSONB), public.my_macro_plan(), public.macro_plan_races_set(UUID, JSONB),
    public.macro_plan_attention_ack(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.macro_plan_save(JSONB), public.my_macro_plan(), public.macro_plan_races_set(UUID, JSONB),
    public.macro_plan_attention_ack(UUID) TO authenticated;
