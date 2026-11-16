-- Lab: test scheduler (docs/lab/test-scheduler.md). Repeating test blocks with SQL-only reminders (pg_cron).
CREATE TABLE IF NOT EXISTS public.lab_test_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    protocol TEXT NOT NULL CHECK (protocol IN ('ftp_ramp', 'ftp_20', 'ftp_8', 'cp3_12', 'cp5_20')),
    interval_weeks INT NOT NULL CHECK (interval_weeks BETWEEN 1 AND 52),
    start_date DATE NOT NULL,
    end_date DATE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lab_schedule_dates_ck CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS lab_test_schedules_athlete_idx ON public.lab_test_schedules (athlete_id);
ALTER TABLE public.lab_test_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_test_schedules FROM PUBLIC, anon, authenticated;

-- One row per reminder sent, so the cron function is idempotent.
CREATE TABLE IF NOT EXISTS public.lab_schedule_reminders (
    schedule_id UUID NOT NULL REFERENCES public.lab_test_schedules(id) ON DELETE CASCADE,
    due_date DATE NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('ahead', 'day')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (schedule_id, due_date, kind)
);
ALTER TABLE public.lab_schedule_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_schedule_reminders FROM PUBLIC, anon, authenticated;

-- First test date on or after p_from (start + k * interval), or NULL once past the end date.
CREATE OR REPLACE FUNCTION public.lab_schedule_next(p_start DATE, p_weeks INT, p_end DATE, p_from DATE)
RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN d IS NULL OR (p_end IS NOT NULL AND d > p_end) THEN NULL ELSE d END
      FROM (SELECT CASE WHEN p_from <= p_start THEN p_start
                        ELSE p_start + (((p_from - p_start) + p_weeks * 7 - 1) / (p_weeks * 7)) * p_weeks * 7 END AS d) x
$$;

CREATE OR REPLACE FUNCTION public.lab_schedule_save(
    p_athlete UUID, p_protocol TEXT, p_weeks INT, p_start DATE, p_end DATE)
RETURNS public.lab_test_schedules
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.lab_test_schedules%ROWTYPE;
BEGIN
    PERFORM public.lab_gate(p_athlete);
    IF p_protocol IS NULL OR p_protocol NOT IN ('ftp_ramp', 'ftp_20', 'ftp_8', 'cp3_12', 'cp5_20') THEN
        RAISE EXCEPTION 'Unknown protocol';
    END IF;
    IF p_weeks IS NULL OR p_weeks NOT BETWEEN 1 AND 52 THEN RAISE EXCEPTION 'Interval must be 1 to 52 weeks'; END IF;
    IF p_start IS NULL OR p_start NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN RAISE EXCEPTION 'Invalid date'; END IF;
    IF p_end IS NOT NULL AND p_end < p_start THEN RAISE EXCEPTION 'End date before start date'; END IF;
    IF (SELECT count(*) FROM public.lab_test_schedules WHERE athlete_id = p_athlete AND active) >= 10 THEN
        RAISE EXCEPTION 'Too many active schedules';
    END IF;
    INSERT INTO public.lab_test_schedules (athlete_id, created_by, protocol, interval_weeks, start_date, end_date)
    VALUES (p_athlete, auth.uid(), p_protocol, p_weeks, p_start, p_end) RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

-- Schedules of an athlete with their next due date.
CREATE OR REPLACE FUNCTION public.lab_schedules_list(p_athlete UUID)
RETURNS TABLE (id UUID, protocol TEXT, interval_weeks INT, start_date DATE, end_date DATE, active BOOLEAN, next_due DATE, created_by UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM public.lab_gate(p_athlete);
    RETURN QUERY
    SELECT s.id, s.protocol, s.interval_weeks, s.start_date, s.end_date, s.active,
           CASE WHEN s.active THEN public.lab_schedule_next(s.start_date, s.interval_weeks, s.end_date, CURRENT_DATE) END,
           s.created_by
      FROM public.lab_test_schedules s WHERE s.athlete_id = p_athlete ORDER BY s.created_at DESC LIMIT 50;
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_schedule_stop(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_athlete UUID;
BEGIN
    SELECT athlete_id INTO v_athlete FROM public.lab_test_schedules WHERE id = p_id;
    IF v_athlete IS NULL THEN RAISE EXCEPTION 'Schedule not found'; END IF;
    PERFORM public.lab_gate(v_athlete);
    UPDATE public.lab_test_schedules SET active = FALSE WHERE id = p_id;
END;
$$;

-- Reminders: 3 days ahead and on the day, once each (lab_test_due to the athlete).
CREATE OR REPLACE FUNCTION public.lab_schedule_tick(p_today DATE DEFAULT CURRENT_DATE)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    s RECORD;
    v_due DATE;
    v_kind TEXT;
    v_n INT := 0;
BEGIN
    FOR s IN SELECT * FROM public.lab_test_schedules WHERE active LOOP
        v_due := public.lab_schedule_next(s.start_date, s.interval_weeks, s.end_date, p_today);
        CONTINUE WHEN v_due IS NULL;
        v_kind := CASE WHEN v_due = p_today THEN 'day' WHEN v_due = p_today + 3 THEN 'ahead' END;
        CONTINUE WHEN v_kind IS NULL;
        INSERT INTO public.lab_schedule_reminders (schedule_id, due_date, kind) VALUES (s.id, v_due, v_kind)
        ON CONFLICT DO NOTHING;
        IF FOUND THEN
            INSERT INTO public.notifications (user_id, actor_id, type) VALUES (s.athlete_id, s.created_by, 'lab_test_due');
            v_n := v_n + 1;
        END IF;
    END LOOP;
    RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.lab_schedule_tick(DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lab_schedule_save(UUID, TEXT, INT, DATE, DATE), public.lab_schedules_list(UUID), public.lab_schedule_stop(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lab_schedule_save(UUID, TEXT, INT, DATE, DATE), public.lab_schedules_list(UUID), public.lab_schedule_stop(UUID), public.lab_schedule_next(DATE, INT, DATE, DATE) TO authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lab-schedule-tick') THEN
        PERFORM cron.unschedule('lab-schedule-tick');
    END IF;
    PERFORM cron.schedule('lab-schedule-tick', '5 6 * * *', 'SELECT public.lab_schedule_tick()');
END;
$$;
