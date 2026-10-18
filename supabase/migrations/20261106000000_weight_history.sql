-- VelocityStack: Body weight history, per-activity weight snapshot (issue #143, part of #119)
-- Same effective-dated history + snapshot pattern as FTP (20261105000000) and lactate
-- thresholds (20261103000000). The snapshot is private to the athlete (not part of the
-- shared activity view) and drives every W/kg figure.

CREATE TABLE IF NOT EXISTS public.weight_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    effective_from DATE NOT NULL,
    weight_kg NUMERIC(4, 1) NOT NULL CHECK (weight_kg BETWEEN 20 AND 300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_weight_history_user_date
    ON public.weight_history(user_id, effective_from DESC);

ALTER TABLE public.weight_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weight_history_select_own" ON public.weight_history;
CREATE POLICY "weight_history_select_own" ON public.weight_history
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "weight_history_insert_own" ON public.weight_history;
CREATE POLICY "weight_history_insert_own" ON public.weight_history
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "weight_history_update_own" ON public.weight_history;
CREATE POLICY "weight_history_update_own" ON public.weight_history
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "weight_history_delete_own" ON public.weight_history;
CREATE POLICY "weight_history_delete_own" ON public.weight_history
    FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.weight_history FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weight_history TO authenticated;

ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS weight_at_activity_kg NUMERIC(4, 1);

-- Backfill (no-op on a fresh history table; safe to re-run): activities without a snapshot.
UPDATE public.activities a
   SET weight_at_activity_kg = (
        SELECT h.weight_kg FROM public.weight_history h
         WHERE h.user_id = a.user_id
           AND h.effective_from <= (a.activity_date AT TIME ZONE 'UTC')::date
         ORDER BY h.effective_from DESC LIMIT 1)
 WHERE a.weight_at_activity_kg IS NULL
   AND EXISTS (SELECT 1 FROM public.weight_history h
                WHERE h.user_id = a.user_id
                  AND h.effective_from <= (a.activity_date AT TIME ZONE 'UTC')::date);

-- New activities pick up the weight valid at their date (unless supplied explicitly).
CREATE OR REPLACE FUNCTION public.set_activity_weight_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.weight_at_activity_kg IS NOT NULL THEN
        RETURN NEW;
    END IF;
    SELECT h.weight_kg INTO NEW.weight_at_activity_kg FROM public.weight_history h
     WHERE h.user_id = NEW.user_id
       AND h.effective_from <= (NEW.activity_date AT TIME ZONE 'UTC')::date
     ORDER BY h.effective_from DESC LIMIT 1;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activities_weight_snapshot ON public.activities;
CREATE TRIGGER trg_activities_weight_snapshot
    BEFORE INSERT ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.set_activity_weight_snapshot();

-- Editing history re-resolves the snapshots from the earliest affected date onwards.
CREATE OR REPLACE FUNCTION public.resnapshot_activity_weight(p_user UUID, p_from DATE)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE public.activities a
       SET weight_at_activity_kg = r.weight
      FROM (SELECT x.id,
                   (SELECT hh.weight_kg FROM public.weight_history hh
                     WHERE hh.user_id = p_user
                       AND hh.effective_from <= (x.activity_date AT TIME ZONE 'UTC')::date
                     ORDER BY hh.effective_from DESC LIMIT 1) AS weight
              FROM public.activities x
             WHERE x.user_id = p_user
               AND (x.activity_date AT TIME ZONE 'UTC')::date >= p_from) r
     WHERE a.id = r.id;
$$;

REVOKE ALL ON FUNCTION public.resnapshot_activity_weight(UUID, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.weight_history_resnapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.resnapshot_activity_weight(OLD.user_id, OLD.effective_from);
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM public.resnapshot_activity_weight(NEW.user_id, LEAST(OLD.effective_from, NEW.effective_from));
    ELSE
        PERFORM public.resnapshot_activity_weight(NEW.user_id, NEW.effective_from);
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_weight_history_resnapshot ON public.weight_history;
CREATE TRIGGER trg_weight_history_resnapshot
    AFTER INSERT OR UPDATE OR DELETE ON public.weight_history
    FOR EACH ROW EXECUTE FUNCTION public.weight_history_resnapshot();
