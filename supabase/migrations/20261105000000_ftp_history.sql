-- VelocityStack: FTP history + reliable per-activity FTP snapshot (issue #142, part of #119)
-- Same effective-dated history + snapshot pattern as lactate thresholds (20261103000000).
-- activities.ftp_at_activity_w is the FTP valid on the activity's date; profiles.ftp_w stays
-- as the athlete's *current* FTP (kept in sync from the history).

CREATE TABLE IF NOT EXISTS public.ftp_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    effective_from DATE NOT NULL,
    ftp_w INTEGER NOT NULL CHECK (ftp_w BETWEEN 1 AND 2500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_ftp_history_user_date
    ON public.ftp_history(user_id, effective_from DESC);

ALTER TABLE public.ftp_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ftp_history_select_own" ON public.ftp_history;
CREATE POLICY "ftp_history_select_own" ON public.ftp_history
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ftp_history_insert_own" ON public.ftp_history;
CREATE POLICY "ftp_history_insert_own" ON public.ftp_history
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ftp_history_update_own" ON public.ftp_history;
CREATE POLICY "ftp_history_update_own" ON public.ftp_history
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ftp_history_delete_own" ON public.ftp_history;
CREATE POLICY "ftp_history_delete_own" ON public.ftp_history
    FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.ftp_history FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ftp_history TO authenticated;

-- Seed: every athlete with a profile FTP and no history gets one entry valid "forever", so
-- existing activities keep a sensible FTP. Runs before the triggers below exist, so nothing is
-- re-snapshotted yet; re-running is a no-op.
INSERT INTO public.ftp_history (user_id, effective_from, ftp_w)
SELECT p.id, DATE '1970-01-01', p.ftp_w
  FROM public.profiles p
 WHERE p.ftp_w IS NOT NULL AND p.ftp_w BETWEEN 1 AND 2500
   AND NOT EXISTS (SELECT 1 FROM public.ftp_history h WHERE h.user_id = p.id)
ON CONFLICT (user_id, effective_from) DO NOTHING;

-- Backfill: only activities that have no snapshot yet (existing snapshots are kept as-is).
UPDATE public.activities a
   SET ftp_at_activity_w = (
        SELECT h.ftp_w FROM public.ftp_history h
         WHERE h.user_id = a.user_id
           AND h.effective_from <= (a.activity_date AT TIME ZONE 'UTC')::date
         ORDER BY h.effective_from DESC LIMIT 1)
 WHERE a.ftp_at_activity_w IS NULL
   AND EXISTS (SELECT 1 FROM public.ftp_history h
                WHERE h.user_id = a.user_id
                  AND h.effective_from <= (a.activity_date AT TIME ZONE 'UTC')::date);

-- Derived load metrics follow the snapshot.
CREATE OR REPLACE FUNCTION public.activity_if_tl(np NUMERIC, elapsed NUMERIC, ftp NUMERIC, OUT if_val NUMERIC, OUT tl_val NUMERIC)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF ftp IS NULL OR ftp <= 0 OR np IS NULL OR elapsed IS NULL THEN
        RETURN;
    END IF;
    if_val := round(np / ftp, 3);
    tl_val := round(elapsed * np * if_val / (ftp * 3600) * 100, 1);
END;
$$;

-- New activities pick up the FTP valid at their date (unless supplied explicitly).
CREATE OR REPLACE FUNCTION public.set_activity_ftp_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.ftp_at_activity_w IS NOT NULL THEN
        RETURN NEW;
    END IF;
    SELECT h.ftp_w INTO NEW.ftp_at_activity_w FROM public.ftp_history h
     WHERE h.user_id = NEW.user_id
       AND h.effective_from <= (NEW.activity_date AT TIME ZONE 'UTC')::date
     ORDER BY h.effective_from DESC LIMIT 1;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activities_ftp_snapshot ON public.activities;
CREATE TRIGGER trg_activities_ftp_snapshot
    BEFORE INSERT ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.set_activity_ftp_snapshot();

-- Editing history re-resolves the snapshot (and IF / training load) of the athlete's
-- activities from the earliest affected date onwards.
CREATE OR REPLACE FUNCTION public.resnapshot_activity_ftp(p_user UUID, p_from DATE)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE public.activities a
       SET ftp_at_activity_w = r.ftp,
           intensity_factor = (public.activity_if_tl(a.normalized_power_w, a.elapsed_time_s, r.ftp)).if_val,
           training_load = (public.activity_if_tl(a.normalized_power_w, a.elapsed_time_s, r.ftp)).tl_val
      FROM (SELECT x.id,
                   (SELECT hh.ftp_w FROM public.ftp_history hh
                     WHERE hh.user_id = p_user
                       AND hh.effective_from <= (x.activity_date AT TIME ZONE 'UTC')::date
                     ORDER BY hh.effective_from DESC LIMIT 1) AS ftp
              FROM public.activities x
             WHERE x.user_id = p_user
               AND (x.activity_date AT TIME ZONE 'UTC')::date >= p_from) r
     WHERE a.id = r.id;
$$;

REVOKE ALL ON FUNCTION public.resnapshot_activity_ftp(UUID, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ftp_history_resnapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    uid UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        uid := OLD.user_id;
        PERFORM public.resnapshot_activity_ftp(uid, OLD.effective_from);
    ELSIF TG_OP = 'UPDATE' THEN
        uid := NEW.user_id;
        PERFORM public.resnapshot_activity_ftp(uid, LEAST(OLD.effective_from, NEW.effective_from));
    ELSE
        uid := NEW.user_id;
        PERFORM public.resnapshot_activity_ftp(uid, NEW.effective_from);
    END IF;
    -- profiles.ftp_w mirrors the entry valid today.
    UPDATE public.profiles
       SET ftp_w = (SELECT h.ftp_w FROM public.ftp_history h
                     WHERE h.user_id = uid AND h.effective_from <= CURRENT_DATE
                     ORDER BY h.effective_from DESC LIMIT 1)
     WHERE id = uid;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ftp_history_resnapshot ON public.ftp_history;
CREATE TRIGGER trg_ftp_history_resnapshot
    AFTER INSERT OR UPDATE OR DELETE ON public.ftp_history
    FOR EACH ROW EXECUTE FUNCTION public.ftp_history_resnapshot();
