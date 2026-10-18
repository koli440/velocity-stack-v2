-- Faster, newest-first history import (follow-up to #109).
--  1. connections: a backward-moving backfill cursor + progress counters, separate from the forward
--     cursor last_synced_at (which keeps picking up new rides while an old backfill is running).
--  2. strava_rate_budget: one service-role-only row with the app-wide Strava read/overall usage taken
--     from the X-ReadRateLimit-* / X-RateLimit-* headers, shared by every rider and every run.
-- Additive and idempotent; never rewrites existing data except marking already-synced connections complete.

-- Existing connections that already have a forward cursor finished (or were mid-way through) the old
-- oldest-first backfill: everything older than last_synced_at is imported and the forward sync handles the
-- rest, so they must not restart a backfill. Only runs when the column does not exist yet.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'connections' AND column_name = 'backfill_complete'
    ) THEN
        ALTER TABLE public.connections ADD COLUMN backfill_complete BOOLEAN NOT NULL DEFAULT FALSE;
        UPDATE public.connections SET backfill_complete = TRUE WHERE last_synced_at IS NOT NULL;
    END IF;
END;
$$;

-- backfill_cursor: everything NEWER than this (inside the backfill window) has been handled; NULL = not started.
-- backfill_imported / backfill_total: progress for the UI (total is NULL while unknown, e.g. Strava).
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS backfill_cursor TIMESTAMPTZ;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS backfill_imported INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS backfill_total INTEGER;

GRANT SELECT (backfill_cursor, backfill_complete, backfill_imported, backfill_total)
    ON public.connections TO authenticated;

-- Restart the backfill when a connection is (re)connected after having been disconnected.
CREATE OR REPLACE FUNCTION public.reset_backfill_on_reconnect()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'disconnected' AND NEW.status <> 'disconnected' THEN
        NEW.backfill_cursor := NULL;
        NEW.backfill_complete := FALSE;
        NEW.backfill_imported := 0;
        NEW.backfill_total := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_backfill_on_reconnect ON public.connections;
CREATE TRIGGER trg_reset_backfill_on_reconnect
    BEFORE UPDATE ON public.connections
    FOR EACH ROW EXECUTE FUNCTION public.reset_backfill_on_reconnect();

-- A changed window restarts the backfill from the newest ride; already imported rides are skipped by
-- external id. The forward cursor (last_synced_at) is left alone so new rides keep arriving promptly.
CREATE OR REPLACE FUNCTION public.set_connection_backfill(p_provider TEXT, p_backfill_days INTEGER)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_backfill_days IS NOT NULL AND (p_backfill_days < 1 OR p_backfill_days > 36500) THEN
        RAISE EXCEPTION 'backfill_days out of range' USING ERRCODE = '22023';
    END IF;
    UPDATE public.connections
    SET backfill_days = p_backfill_days,
        backfill_cursor = NULL,
        backfill_complete = FALSE,
        backfill_imported = 0,
        backfill_total = NULL,
        last_attempt_at = NULL,
        updated_at = NOW()
    WHERE user_id = auth.uid() AND provider = p_provider;
END;
$$;
REVOKE ALL ON FUNCTION public.set_connection_backfill(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_connection_backfill(TEXT, INTEGER) TO authenticated;

-- Service-side backfill progress. Ignored when the window was changed meanwhile (p_backfill_days is the
-- value the run started with) so a stale run cannot mark a restarted backfill complete.
CREATE OR REPLACE FUNCTION public.record_backfill_progress(
    p_user_id UUID, p_provider TEXT, p_backfill_days INTEGER,
    p_cursor TIMESTAMPTZ, p_complete BOOLEAN, p_imported_delta INTEGER, p_total INTEGER
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.connections
    SET backfill_cursor = COALESCE(p_cursor, backfill_cursor),
        backfill_complete = COALESCE(p_complete, backfill_complete),
        backfill_imported = GREATEST(0, backfill_imported + COALESCE(p_imported_delta, 0)),
        backfill_total = COALESCE(p_total, backfill_total),
        updated_at = NOW()
    WHERE user_id = p_user_id AND provider = p_provider AND status <> 'disconnected'
      AND backfill_days IS NOT DISTINCT FROM p_backfill_days;
END;
$$;
REVOKE ALL ON FUNCTION public.record_backfill_progress(UUID, TEXT, INTEGER, TIMESTAMPTZ, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_backfill_progress(UUID, TEXT, INTEGER, TIMESTAMPTZ, BOOLEAN, INTEGER, INTEGER) TO service_role;

-- App-wide Strava API usage (one row, id = 1). Service role only: RLS on, no client grants.
CREATE TABLE IF NOT EXISTS public.strava_rate_budget (
    id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    window_15m_start    TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(floor(extract(epoch FROM now()) / 900) * 900),
    window_day          DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
    read_15m_usage      INTEGER NOT NULL DEFAULT 0,
    read_15m_limit      INTEGER NOT NULL DEFAULT 200,
    read_day_usage      INTEGER NOT NULL DEFAULT 0,
    read_day_limit      INTEGER NOT NULL DEFAULT 2000,
    overall_15m_usage   INTEGER NOT NULL DEFAULT 0,
    overall_15m_limit   INTEGER NOT NULL DEFAULT 400,
    overall_day_usage   INTEGER NOT NULL DEFAULT 0,
    overall_day_limit   INTEGER NOT NULL DEFAULT 4000,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.strava_rate_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.strava_rate_budget FROM PUBLIC, anon, authenticated;

INSERT INTO public.strava_rate_budget (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Merge observed usage. Counters only grow inside a window (GREATEST) so concurrent runs cannot lower each
-- other's numbers; a new 15-minute window (:00/:15/:30/:45) or UTC day starts from the observed value.
CREATE OR REPLACE FUNCTION public.record_strava_rate_usage(
    p_read_15m_usage INTEGER, p_read_day_usage INTEGER,
    p_overall_15m_usage INTEGER, p_overall_day_usage INTEGER,
    p_read_15m_limit INTEGER DEFAULT NULL, p_read_day_limit INTEGER DEFAULT NULL,
    p_overall_15m_limit INTEGER DEFAULT NULL, p_overall_day_limit INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_w15 TIMESTAMPTZ := to_timestamp(floor(extract(epoch FROM now()) / 900) * 900);
    v_day DATE := (now() AT TIME ZONE 'UTC')::date;
BEGIN
    INSERT INTO public.strava_rate_budget (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    UPDATE public.strava_rate_budget SET
        read_15m_usage    = CASE WHEN window_15m_start = v_w15 THEN GREATEST(read_15m_usage, COALESCE(p_read_15m_usage, 0)) ELSE COALESCE(p_read_15m_usage, 0) END,
        overall_15m_usage = CASE WHEN window_15m_start = v_w15 THEN GREATEST(overall_15m_usage, COALESCE(p_overall_15m_usage, 0)) ELSE COALESCE(p_overall_15m_usage, 0) END,
        read_day_usage    = CASE WHEN window_day = v_day THEN GREATEST(read_day_usage, COALESCE(p_read_day_usage, 0)) ELSE COALESCE(p_read_day_usage, 0) END,
        overall_day_usage = CASE WHEN window_day = v_day THEN GREATEST(overall_day_usage, COALESCE(p_overall_day_usage, 0)) ELSE COALESCE(p_overall_day_usage, 0) END,
        read_15m_limit    = COALESCE(NULLIF(p_read_15m_limit, 0), read_15m_limit),
        read_day_limit    = COALESCE(NULLIF(p_read_day_limit, 0), read_day_limit),
        overall_15m_limit = COALESCE(NULLIF(p_overall_15m_limit, 0), overall_15m_limit),
        overall_day_limit = COALESCE(NULLIF(p_overall_day_limit, 0), overall_day_limit),
        window_15m_start  = v_w15,
        window_day        = v_day,
        updated_at        = NOW()
    WHERE id = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.record_strava_rate_usage(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_strava_rate_usage(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;
