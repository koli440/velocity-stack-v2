-- Hero cards (issue #216): persisted power-over-time preview, like route_preview.
-- power_preview = {"kind":"power","step_s":N,"values":[avg watts per N-second bucket, ...]} (~80 points)
-- or {"kind":"none"} when the activity has no usable power. The feed never reads time_series.

ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS power_preview JSONB;

-- Mirrors buildPowerPreview() in src/lib/powerPreview.js.
CREATE OR REPLACE FUNCTION public.build_power_preview(p_watts JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
    WITH s AS (
        SELECT (e.v)::text::float8 AS w, row_number() OVER (ORDER BY e.ord) - 1 AS idx
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_watts) = 'array' THEN p_watts ELSE '[]'::jsonb END) WITH ORDINALITY AS e(v, ord)
        WHERE jsonb_typeof(e.v) = 'number'
    ),
    st AS (
        SELECT count(*)::int AS n, bool_or(w > 0) AS has_power, ceil(count(*) / 80.0)::int AS step FROM s
    ),
    b AS (
        SELECT (s.idx / st.step)::int AS bucket, greatest(0, round(avg(s.w)))::int AS val
        FROM s, st
        WHERE st.n >= 10
        GROUP BY 1
    )
    SELECT CASE
        WHEN (SELECT n FROM st) >= 10 AND COALESCE((SELECT has_power FROM st), false) THEN
            jsonb_build_object(
                'kind', 'power',
                'step_s', (SELECT step FROM st),
                'values', (SELECT jsonb_agg(val ORDER BY bucket) FROM b))
        ELSE jsonb_build_object('kind', 'none')
    END;
$$;

-- Safety net for SQL-side ingestion (bot generator, imports): fill it when missing.
CREATE OR REPLACE FUNCTION public.activities_set_power_preview()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.power_preview IS NULL AND NEW.time_series IS NOT NULL THEN
        NEW.power_preview := public.build_power_preview(NEW.time_series -> 'watts');
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activities_power_preview ON public.activities;
CREATE TRIGGER trg_activities_power_preview
    BEFORE INSERT ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.activities_set_power_preview();

-- Backfill existing rows.
UPDATE public.activities
SET power_preview = public.build_power_preview(time_series -> 'watts')
WHERE power_preview IS NULL AND time_series IS NOT NULL;

-- Expose it through the masked view (new column appended at the end).
CREATE OR REPLACE VIEW public.shared_activities AS
    SELECT
        a.id,
        a.user_id,
        a.track_id,
        a.title,
        a.description,
        a.activity_date,
        a.created_at,
        a.chainring,
        a.cog,
        a.crank_length_mm,
        a.distance_m,
        a.max_cadence_rpm,
        a.max_speed_kmh,
        a.max_power_w,
        a.peak_torque_nm,
        a.start_time,
        a.elapsed_time_s,
        a.moving_time_s,
        a.avg_speed_kmh,
        a.avg_power_w,
        a.normalized_power_w,
        a.avg_cadence_rpm,
        a.avg_torque_nm,
        a.avg_hr,
        a.max_hr,
        a.elevation_gain_m,
        a.elevation_loss_m,
        a.intensity_factor,
        a.training_load,
        a.speed_source,
        a.bike_model,
        a.handlebar_setup,
        a.helmet,
        a.perceived_exertion,
        a.curves_data,
        a.processing_status,
        a.visibility,
        a.badges,
        (SELECT jsonb_build_object('name', t.name, 'length_m', t.length_m, 'surface', t.surface)
           FROM public.tracks t WHERE t.id = a.track_id) AS tracks,
        CASE
            WHEN COALESCE(a.route_preview_zone, 'none') =
                 public.zone_signature(p.privacy_zone_lat, p.privacy_zone_lng, p.privacy_zone_radius_m)
            THEN a.route_preview
            ELSE NULL
        END AS route_preview,
        CASE
            WHEN a.time_series IS NULL THEN NULL
            ELSE (a.time_series - 'latitude' - 'longitude')
        END AS time_series,
        a.power_preview
    FROM public.activities a
    JOIN public.profiles p ON p.id = a.user_id
    WHERE a.user_id = auth.uid()
       OR public.is_coach_of(a.user_id)
       OR (
            NOT public.is_blocked_between(auth.uid(), a.user_id)
            AND (
                a.visibility = 'public'
                OR (
                    a.visibility = 'followers'
                    AND EXISTS (
                        SELECT 1 FROM public.follows f
                        WHERE f.follower_id = auth.uid() AND f.followee_id = a.user_id
                    )
                )
            )
       );

REVOKE ALL ON public.shared_activities FROM PUBLIC, anon;
GRANT SELECT ON public.shared_activities TO authenticated;
