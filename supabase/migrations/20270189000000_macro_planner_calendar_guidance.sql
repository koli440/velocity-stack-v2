-- Macro planner guidance in the athlete's calendar (docs/macro-planner.md, "Plan guidance in the calendar").
-- The coach sees the plan (week targets, focus, day shape, races) in the athlete's calendar; the athlete only when the coach
-- shared it per plan (default off). Read-only, flag- and relationship-enforced here, not only in the UI. Additive and idempotent.
-- Only what is stored in macro_plan_weeks / macro_plan_races is returned, i.e. the plan the coach saved or applied: suggested
-- options (disruptions, availability, reviews) are computed client-side, never stored as the plan, and never returned here.

ALTER TABLE public.macro_plans ADD COLUMN IF NOT EXISTS share_calendar BOOLEAN NOT NULL DEFAULT FALSE;

-- Coach: share (or stop sharing) the guidance with the athlete's own calendar.
CREATE OR REPLACE FUNCTION public.macro_plan_calendar_share_set(p_plan UUID, p_share BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.macro_plan_authorize(p_plan);
    UPDATE public.macro_plans SET share_calendar = COALESCE(p_share, FALSE), updated_at = NOW() WHERE id = p_plan;
END;
$$;

-- Plan guidance for the calendar of p_rider, or NULL (quietly: the calendar calls this on every view).
--  * coach (flag on, active unblocked relationship, own plan): the plan incl. attention, share flags and viewer 'coach'
--  * athlete (own calendar): only a PUBLISHED plan with share_calendar on, from a coach that still has the flag and an
--    active relationship; no attention flag, race ids, missing races, share flags; rationale only when share_reasoning is on
CREATE OR REPLACE FUNCTION public.macro_plan_calendar(p_rider UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_id UUID;
    v_json JSONB;
    v_share BOOLEAN;
    v_reason BOOLEAN;
BEGIN
    IF v_me IS NULL OR p_rider IS NULL THEN RETURN NULL; END IF;
    IF v_me <> p_rider THEN
        IF NOT public.macro_planner_enabled(v_me) OR NOT public.is_coach_of(p_rider) THEN RETURN NULL; END IF;
        SELECT m.id, m.share_calendar INTO v_id, v_share FROM public.macro_plans m WHERE m.coach_id = v_me AND m.rider_id = p_rider;
        IF v_id IS NULL THEN RETURN NULL; END IF;
        RETURN public.macro_plan_json(v_id) || jsonb_build_object('viewer', 'coach', 'share_calendar', v_share);
    END IF;
    SELECT m.id, m.share_reasoning INTO v_id, v_reason
    FROM public.macro_plans m
    WHERE m.rider_id = v_me AND m.status = 'published' AND m.share_calendar
      AND m.coach_id <> m.rider_id
      AND public.macro_planner_enabled(m.coach_id)
      AND EXISTS (SELECT 1 FROM public.coaching_relationships c
                  WHERE c.coach_id = m.coach_id AND c.rider_id = m.rider_id AND c.status = 'active'
                    AND NOT public.is_blocked_between(c.coach_id, c.rider_id))
    LIMIT 1;
    IF v_id IS NULL THEN RETURN NULL; END IF;
    v_json := public.macro_plan_json(v_id) - 'attention' - 'race_id' - 'share_reasoning' - 'coach_id' - 'rider_id';
    v_json := v_json || jsonb_build_object('viewer', 'athlete', 'races', COALESCE((
        SELECT jsonb_agg(r - 'race_id' - 'missing' ORDER BY ord) FROM jsonb_array_elements(v_json->'races') WITH ORDINALITY AS t(r, ord)
        WHERE NOT (r->>'missing')::BOOLEAN), '[]'::JSONB));
    IF NOT COALESCE(v_reason, FALSE) THEN
        v_json := (v_json - 'plan_rationale') || jsonb_build_object('weeks', COALESCE((
            SELECT jsonb_agg(w - 'rationale' ORDER BY ord) FROM jsonb_array_elements(v_json->'weeks') WITH ORDINALITY AS t(w, ord)), '[]'::JSONB));
    END IF;
    RETURN v_json;
END;
$$;

REVOKE ALL ON FUNCTION public.macro_plan_calendar(UUID), public.macro_plan_calendar_share_set(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.macro_plan_calendar(UUID), public.macro_plan_calendar_share_set(UUID, BOOLEAN) TO authenticated;
