-- VelocityStack: Power zones Z1-Z6 (issue #194, part of #119)
-- LT-based, user-editable zone boundaries with the same effective-dated history +
-- per-activity snapshot pattern as FTP, lactate thresholds and body weight.
-- Boundaries are stored as percentages: z1/z2 upper bounds relative to LT1 power, z3/z4/z5
-- upper bounds relative to LT2 power. Defaults (75, 100, 100, 105, 120) are applied by the
-- app when an athlete has no history; an activity's snapshot is NULL in that case.

CREATE TABLE IF NOT EXISTS public.power_zone_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    effective_from DATE NOT NULL,
    z1_max_pct SMALLINT NOT NULL,
    z2_max_pct SMALLINT NOT NULL,
    z3_max_pct SMALLINT NOT NULL,
    z4_max_pct SMALLINT NOT NULL,
    z5_max_pct SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, effective_from),
    CONSTRAINT pz_hist_range CHECK (
        z1_max_pct BETWEEN 1 AND 300 AND z2_max_pct BETWEEN 1 AND 300
        AND z3_max_pct BETWEEN 1 AND 300 AND z4_max_pct BETWEEN 1 AND 300
        AND z5_max_pct BETWEEN 1 AND 300
    ),
    CONSTRAINT pz_hist_order CHECK (
        z1_max_pct < z2_max_pct AND z3_max_pct < z4_max_pct AND z4_max_pct < z5_max_pct
    )
);

CREATE INDEX IF NOT EXISTS idx_pz_history_user_date
    ON public.power_zone_history(user_id, effective_from DESC);

ALTER TABLE public.power_zone_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pz_history_select_own" ON public.power_zone_history;
CREATE POLICY "pz_history_select_own" ON public.power_zone_history
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "pz_history_insert_own" ON public.power_zone_history;
CREATE POLICY "pz_history_insert_own" ON public.power_zone_history
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "pz_history_update_own" ON public.power_zone_history;
CREATE POLICY "pz_history_update_own" ON public.power_zone_history
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "pz_history_delete_own" ON public.power_zone_history;
CREATE POLICY "pz_history_delete_own" ON public.power_zone_history
    FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.power_zone_history FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.power_zone_history TO authenticated;

-- Snapshot on activities (private): [z1, z2, z3, z4, z5] upper-bound percentages, or NULL = defaults.
ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS power_zone_pcts_at_activity INTEGER[];

CREATE OR REPLACE FUNCTION public.set_activity_power_zone_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    h public.power_zone_history%ROWTYPE;
BEGIN
    IF NEW.power_zone_pcts_at_activity IS NOT NULL THEN
        RETURN NEW;
    END IF;
    SELECT * INTO h FROM public.power_zone_history
     WHERE user_id = NEW.user_id
       AND effective_from <= (NEW.activity_date AT TIME ZONE 'UTC')::date
     ORDER BY effective_from DESC LIMIT 1;
    IF FOUND THEN
        NEW.power_zone_pcts_at_activity := ARRAY[h.z1_max_pct, h.z2_max_pct, h.z3_max_pct, h.z4_max_pct, h.z5_max_pct]::INTEGER[];
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activities_power_zone_snapshot ON public.activities;
CREATE TRIGGER trg_activities_power_zone_snapshot
    BEFORE INSERT ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.set_activity_power_zone_snapshot();

-- Editing history re-resolves the snapshots from the earliest affected date onwards.
CREATE OR REPLACE FUNCTION public.resnapshot_activity_power_zones(p_user UUID, p_from DATE)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE public.activities a
       SET power_zone_pcts_at_activity = CASE WHEN h.id IS NULL THEN NULL
               ELSE ARRAY[h.z1_max_pct, h.z2_max_pct, h.z3_max_pct, h.z4_max_pct, h.z5_max_pct]::INTEGER[] END
      FROM (SELECT x.id,
                   (SELECT hh.id FROM public.power_zone_history hh
                     WHERE hh.user_id = p_user
                       AND hh.effective_from <= (x.activity_date AT TIME ZONE 'UTC')::date
                     ORDER BY hh.effective_from DESC LIMIT 1) AS hist
              FROM public.activities x
             WHERE x.user_id = p_user
               AND (x.activity_date AT TIME ZONE 'UTC')::date >= p_from) r
      LEFT JOIN public.power_zone_history h ON h.id = r.hist
     WHERE a.id = r.id;
$$;

REVOKE ALL ON FUNCTION public.resnapshot_activity_power_zones(UUID, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.power_zone_history_resnapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.resnapshot_activity_power_zones(OLD.user_id, OLD.effective_from);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM public.resnapshot_activity_power_zones(NEW.user_id, LEAST(OLD.effective_from, NEW.effective_from));
    ELSE
        PERFORM public.resnapshot_activity_power_zones(NEW.user_id, NEW.effective_from);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_power_zone_history_resnapshot ON public.power_zone_history;
CREATE TRIGGER trg_power_zone_history_resnapshot
    AFTER INSERT OR UPDATE OR DELETE ON public.power_zone_history
    FOR EACH ROW EXECUTE FUNCTION public.power_zone_history_resnapshot();

-- Backfill (idempotent): existing activities of athletes that already have zone history get
-- their snapshot; everyone else keeps NULL, which means the default zone model.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT user_id, MIN(effective_from) AS d FROM public.power_zone_history GROUP BY user_id LOOP
        PERFORM public.resnapshot_activity_power_zones(r.user_id, r.d);
    END LOOP;
END;
$$;
