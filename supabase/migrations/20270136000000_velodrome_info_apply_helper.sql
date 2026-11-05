-- Velodrome info data: tolerant, fill-only applier + persistent skip log (docs/velodrome-research/PROCESS.md).
-- Replaces the one-shot DO blocks of the never-applied 20270136/20270137 migrations. The small data migrations
-- 20270136010001+ (strict rules) and 20270136020001+ (relaxed delta) call public.apply_velodrome_info() and can
-- never block the migration pipeline: an unmatched/ambiguous track, a rejected field or any other error is
-- logged to public.track_info_apply_log and skipped. Idempotent; safe to re-run.

-- 1. Persistent record of everything that was skipped, rejected or matched by fallback ------------------
-- Not public: no grants for anon/authenticated (RLS on, no policies). Readable by service_role and by the
-- SQL editor (postgres). See docs/velodrome-research/post-deploy-check.sql.
CREATE TABLE IF NOT EXISTS public.track_info_apply_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch TEXT NOT NULL,
    track_name TEXT,
    country_code TEXT,
    field TEXT,
    outcome TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- outcome: skipped_no_match | skipped_ambiguous | matched_by_name_normalised | matched_by_coordinates |
--          field_rejected | field_conflict | track_error | batch_error
ALTER TABLE public.track_info_apply_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.track_info_apply_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.track_info_apply_log TO service_role;

-- 2. Logging must never fail the caller ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.velodrome_info_log(
    p_batch TEXT, p_track TEXT, p_cc TEXT, p_field TEXT, p_outcome TEXT, p_detail TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.track_info_apply_log (batch, track_name, country_code, field, outcome, detail)
    VALUES (p_batch, p_track, p_cc, p_field, p_outcome, left(p_detail, 1000));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'velodrome info: could not write apply log (%): %', SQLERRM, p_outcome;
END;
$$;
REVOKE ALL ON FUNCTION public.velodrome_info_log(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.velodrome_info_log(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- 3. The applier -----------------------------------------------------------------------------------------
-- p_data: [{name, cc, lat, lon, entries: [{field, status, value, json, url, kind, quote, conf, date}]}]
-- Track matching: (1) name + country_code, (2) whitespace/case-normalised name + country_code,
-- (3) coordinates within 0.01 degrees + country_code. Anything but exactly one row at a step moves on to the
-- next step; no match at all => NOTICE + log + skip. Values are fill-only: an existing different value is
-- never overwritten and is recorded as needs_attention. Every field is applied in its own sub-transaction.
CREATE OR REPLACE FUNCTION public.apply_velodrome_info(p_batch TEXT, p_data JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    t JSONB;
    e JSONB;
    v_name TEXT;
    v_cc TEXT;
    v_lat NUMERIC;
    v_lon NUMERIC;
    v_id UUID;
    v_cnt INT;
    v_cnt1 INT;
    v_cnt2 INT;
    v_cnt3 INT;
    v_how TEXT;
    v_field TEXT;
    v_cur TEXT;
    v_new TEXT;
    v_ok BOOLEAN;
    v_status TEXT;
    v_json JSONB;
    v_date DATE;
BEGIN
    FOR t IN SELECT * FROM jsonb_array_elements(p_data) LOOP
        v_name := t->>'name';
        v_cc := t->>'cc';
        v_id := NULL;
        v_how := NULL;
        v_cnt1 := 0;
        v_cnt2 := 0;
        v_cnt3 := 0;
        BEGIN
            v_lat := NULLIF(t->>'lat', '')::numeric;
            v_lon := NULLIF(t->>'lon', '')::numeric;

            SELECT count(*), (array_agg(id))[1] INTO v_cnt1, v_id FROM public.tracks
            WHERE name = v_name AND country_code IS NOT DISTINCT FROM v_cc;
            IF v_cnt1 = 1 THEN
                v_how := 'exact';
            ELSE
                v_id := NULL;
                SELECT count(*), (array_agg(id))[1] INTO v_cnt2, v_id FROM public.tracks
                WHERE lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) = lower(btrim(regexp_replace(v_name, '\s+', ' ', 'g')))
                  AND country_code IS NOT DISTINCT FROM v_cc;
                IF v_cnt2 = 1 THEN
                    v_how := 'matched_by_name_normalised';
                ELSE
                    v_id := NULL;
                    v_cnt3 := 0;
                    IF v_lat IS NOT NULL AND v_lon IS NOT NULL THEN
                        SELECT count(*), (array_agg(id))[1] INTO v_cnt3, v_id FROM public.tracks
                        WHERE country_code IS NOT DISTINCT FROM v_cc
                          AND latitude IS NOT NULL AND longitude IS NOT NULL
                          AND abs(latitude - v_lat) <= 0.01 AND abs(longitude - v_lon) <= 0.01;
                    END IF;
                    IF v_cnt3 = 1 THEN
                        v_how := 'matched_by_coordinates';
                    ELSE
                        v_id := NULL;
                    END IF;
                END IF;
            END IF;

            IF v_id IS NULL THEN
                v_cnt := GREATEST(v_cnt1, COALESCE(v_cnt2, 0), COALESCE(v_cnt3, 0));
                RAISE NOTICE 'velodrome info: skipping % (%): no single matching tracks row (name %, normalised %, coordinates %)',
                    v_name, v_cc, v_cnt1, COALESCE(v_cnt2, 0), COALESCE(v_cnt3, 0);
                PERFORM public.velodrome_info_log(p_batch, v_name, v_cc, NULL,
                    CASE WHEN v_cnt > 1 THEN 'skipped_ambiguous' ELSE 'skipped_no_match' END,
                    format('matches: exact %s, normalised name %s, coordinates %s', v_cnt1, COALESCE(v_cnt2, 0), COALESCE(v_cnt3, 0)));
                CONTINUE;
            END IF;
            IF v_how <> 'exact' THEN
                RAISE NOTICE 'velodrome info: % (%) matched via %', v_name, v_cc, v_how;
                PERFORM public.velodrome_info_log(p_batch, v_name, v_cc, NULL, v_how, 'applied to tracks.id ' || v_id);
            END IF;

            FOR e IN SELECT * FROM jsonb_array_elements(t->'entries') LOOP
                v_field := e->>'field';
                BEGIN
                    v_status := e->>'status';
                    v_json := e->'json';
                    v_date := (e->>'date')::date;
                    v_new := e->>'value';
                    v_ok := TRUE;

                    IF v_status = 'verified' THEN
                        -- Fill-only: write the column only when it is empty or already equal; a differing value is
                        -- never overwritten and is recorded as needs_attention instead.
                        IF v_field IN ('website_url', 'booking_url', 'pricing_url', 'operator', 'phone', 'email', 'opening_hours') THEN
                            EXECUTE format('SELECT %I FROM public.tracks WHERE id = $1', v_field) INTO v_cur USING v_id;
                            v_ok := v_cur IS NULL OR v_cur = v_new;
                            IF v_ok THEN
                                IF v_field IN ('phone', 'email') THEN
                                    -- Only organisational contacts are ever generated; the flag must be set in the same statement.
                                    EXECUTE format('UPDATE public.tracks SET %I = $2, contact_is_organisational = TRUE WHERE id = $1', v_field) USING v_id, v_new;
                                ELSE
                                    EXECUTE format('UPDATE public.tracks SET %I = $2 WHERE id = $1', v_field) USING v_id, v_new;
                                END IF;
                            END IF;
                        ELSIF v_field = 'year_built' THEN
                            SELECT year_built::text INTO v_cur FROM public.tracks WHERE id = v_id;
                            v_ok := v_cur IS NULL OR v_cur = v_new;
                            IF v_ok THEN UPDATE public.tracks SET year_built = v_new::smallint WHERE id = v_id; END IF;
                        ELSIF v_field = 'price_range' THEN
                            SELECT (price_min IS NULL AND price_max IS NULL AND price_currency IS NULL)
                                OR (price_min IS NOT DISTINCT FROM (v_json->>'min')::numeric
                                    AND price_max IS NOT DISTINCT FROM (v_json->>'max')::numeric
                                    AND price_currency IS NOT DISTINCT FROM (v_json->>'currency'))
                              INTO v_ok FROM public.tracks WHERE id = v_id;
                            IF v_ok THEN
                                UPDATE public.tracks SET price_min = (v_json->>'min')::numeric, price_max = (v_json->>'max')::numeric,
                                       price_currency = v_json->>'currency' WHERE id = v_id;
                            END IF;
                        ELSIF v_field = 'operating_status' THEN
                            SELECT operating_status INTO v_cur FROM public.tracks WHERE id = v_id;
                            v_ok := v_cur = 'unknown' OR v_cur = v_new;
                            IF v_ok THEN
                                UPDATE public.tracks SET operating_status = v_new, operating_status_checked_at = v_date WHERE id = v_id;
                            END IF;
                        ELSE
                            RAISE EXCEPTION 'unsupported field %', v_field;
                        END IF;
                        IF NOT v_ok THEN
                            RAISE NOTICE 'velodrome info: % % already has a different value; recorded as needs_attention', v_name, v_field;
                            PERFORM public.velodrome_info_log(p_batch, v_name, v_cc, v_field, 'field_conflict', 'existing different value kept');
                            v_status := 'needs_attention';
                        END IF;
                    END IF;

                    -- Never demote an established verified row to a weaker status.
                    IF v_status <> 'verified' AND EXISTS (
                        SELECT 1 FROM public.track_info_sources s
                        WHERE s.track_id = v_id AND s.field = v_field AND s.is_current AND s.status = 'verified') THEN
                        CONTINUE;
                    END IF;

                    PERFORM public.upsert_track_info_source(
                        v_id, v_field, v_status, v_new, v_json, e->>'url', e->>'kind', e->>'quote', e->>'conf', NULL, v_date);
                EXCEPTION WHEN OTHERS THEN
                    -- The failed field (value update and provenance) is rolled back; the rest of the track goes on.
                    RAISE NOTICE 'velodrome info: % %: field rejected (%): %', v_name, v_field, SQLSTATE, SQLERRM;
                    PERFORM public.velodrome_info_log(p_batch, v_name, v_cc, v_field, 'field_rejected', SQLSTATE || ': ' || SQLERRM);
                END;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'velodrome info: % (%): track skipped (%): %', v_name, v_cc, SQLSTATE, SQLERRM;
            PERFORM public.velodrome_info_log(p_batch, v_name, v_cc, NULL, 'track_error', SQLSTATE || ': ' || SQLERRM);
        END;
    END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_velodrome_info(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_velodrome_info(TEXT, JSONB) TO service_role;
