-- VelocityStack: Lactate thresholds (issue #121, part of #119)
-- Per-athlete LT1/LT2 (power W + heart rate bpm), effective-dated history, and a
-- point-in-time snapshot on every activity (like ftp_at_activity_w).

CREATE TABLE IF NOT EXISTS public.lactate_threshold_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    effective_from DATE NOT NULL,
    lt1_power_w INTEGER,
    lt1_hr INTEGER,
    lt2_power_w INTEGER,
    lt2_hr INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, effective_from),
    CONSTRAINT lt_hist_any_value CHECK (
        lt1_power_w IS NOT NULL OR lt1_hr IS NOT NULL OR lt2_power_w IS NOT NULL OR lt2_hr IS NOT NULL
    ),
    CONSTRAINT lt_hist_power_range CHECK (
        (lt1_power_w IS NULL OR lt1_power_w BETWEEN 1 AND 2500)
        AND (lt2_power_w IS NULL OR lt2_power_w BETWEEN 1 AND 2500)
        AND (lt1_power_w IS NULL OR lt2_power_w IS NULL OR lt1_power_w < lt2_power_w)
    ),
    CONSTRAINT lt_hist_hr_range CHECK (
        (lt1_hr IS NULL OR lt1_hr BETWEEN 30 AND 250)
        AND (lt2_hr IS NULL OR lt2_hr BETWEEN 30 AND 250)
        AND (lt1_hr IS NULL OR lt2_hr IS NULL OR lt1_hr < lt2_hr)
    )
);

CREATE INDEX IF NOT EXISTS idx_lt_history_user_date
    ON public.lactate_threshold_history(user_id, effective_from DESC);

ALTER TABLE public.lactate_threshold_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lt_history_select_own" ON public.lactate_threshold_history;
CREATE POLICY "lt_history_select_own" ON public.lactate_threshold_history
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "lt_history_insert_own" ON public.lactate_threshold_history;
CREATE POLICY "lt_history_insert_own" ON public.lactate_threshold_history
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "lt_history_update_own" ON public.lactate_threshold_history;
CREATE POLICY "lt_history_update_own" ON public.lactate_threshold_history
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "lt_history_delete_own" ON public.lactate_threshold_history;
CREATE POLICY "lt_history_delete_own" ON public.lactate_threshold_history
    FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.lactate_threshold_history FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lactate_threshold_history TO authenticated;

-- Snapshot columns on activities (private: never exposed to other riders).
ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS lt1_power_at_activity_w INTEGER,
    ADD COLUMN IF NOT EXISTS lt1_hr_at_activity INTEGER,
    ADD COLUMN IF NOT EXISTS lt2_power_at_activity_w INTEGER,
    ADD COLUMN IF NOT EXISTS lt2_hr_at_activity INTEGER;

-- New activities pick up the thresholds valid at their date (unless supplied explicitly).
CREATE OR REPLACE FUNCTION public.set_activity_lt_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    h public.lactate_threshold_history%ROWTYPE;
BEGIN
    IF NEW.lt1_power_at_activity_w IS NOT NULL OR NEW.lt1_hr_at_activity IS NOT NULL
       OR NEW.lt2_power_at_activity_w IS NOT NULL OR NEW.lt2_hr_at_activity IS NOT NULL THEN
        RETURN NEW;
    END IF;
    SELECT * INTO h FROM public.lactate_threshold_history
     WHERE user_id = NEW.user_id
       AND effective_from <= (NEW.activity_date AT TIME ZONE 'UTC')::date
     ORDER BY effective_from DESC LIMIT 1;
    IF FOUND THEN
        NEW.lt1_power_at_activity_w := h.lt1_power_w;
        NEW.lt1_hr_at_activity := h.lt1_hr;
        NEW.lt2_power_at_activity_w := h.lt2_power_w;
        NEW.lt2_hr_at_activity := h.lt2_hr;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activities_lt_snapshot ON public.activities;
CREATE TRIGGER trg_activities_lt_snapshot
    BEFORE INSERT ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.set_activity_lt_snapshot();

-- Editing history re-resolves the snapshots of the athlete's activities from the
-- earliest affected date onwards.
CREATE OR REPLACE FUNCTION public.resnapshot_activity_lt(p_user UUID, p_from DATE)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE public.activities a
       SET lt1_power_at_activity_w = h.lt1_power_w,
           lt1_hr_at_activity = h.lt1_hr,
           lt2_power_at_activity_w = h.lt2_power_w,
           lt2_hr_at_activity = h.lt2_hr
      FROM (SELECT x.id,
                   (SELECT hh.id FROM public.lactate_threshold_history hh
                     WHERE hh.user_id = p_user
                       AND hh.effective_from <= (x.activity_date AT TIME ZONE 'UTC')::date
                     ORDER BY hh.effective_from DESC LIMIT 1) AS hist
              FROM public.activities x
             WHERE x.user_id = p_user
               AND (x.activity_date AT TIME ZONE 'UTC')::date >= p_from) r
      LEFT JOIN public.lactate_threshold_history h ON h.id = r.hist
     WHERE a.id = r.id;
$$;

REVOKE ALL ON FUNCTION public.resnapshot_activity_lt(UUID, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lt_history_resnapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.resnapshot_activity_lt(OLD.user_id, OLD.effective_from);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM public.resnapshot_activity_lt(NEW.user_id, LEAST(OLD.effective_from, NEW.effective_from));
    ELSE
        PERFORM public.resnapshot_activity_lt(NEW.user_id, NEW.effective_from);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lt_history_resnapshot ON public.lactate_threshold_history;
CREATE TRIGGER trg_lt_history_resnapshot
    AFTER INSERT OR UPDATE OR DELETE ON public.lactate_threshold_history
    FOR EACH ROW EXECUTE FUNCTION public.lt_history_resnapshot();
