-- Fix: bots_route_preview() built a FLAT array [x1,y1,x2,y2,...] (jsonb || jsonb_build_array(x, y)),
-- but route_preview.points must be [[x,y],...]. Append one [x,y] pair per point instead.
-- (bots_curve only concatenates objects with jsonb_build_object, which is correct.)
CREATE OR REPLACE FUNCTION public.bots_route_preview(p_len DOUBLE PRECISION)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    r DOUBLE PRECISION := p_len / (2 * pi() + 4);
    scale DOUBLE PRECISION := 84 / (4 * r);
    pts JSONB := '[]'::jsonb;
    xy DOUBLE PRECISION[];
BEGIN
    FOR i IN 0..40 LOOP
        xy := public.bots_track_xy(p_len * i / 40.0, p_len);
        pts := pts || jsonb_build_array(jsonb_build_array(
            round((8 + (xy[1] + 2 * r) * scale)::numeric, 1),
            round((29 + (r - xy[2]) * scale)::numeric, 1)));
    END LOOP;
    RETURN jsonb_build_object('kind', 'route', 'points', pts);
END;
$$;

-- Repair existing bot activities: the preview is normalised to the 100x100 box, so it does not
-- depend on track length and can be regenerated with any length.
UPDATE public.activities a
SET route_preview = public.bots_route_preview(250)
WHERE a.user_id IN (SELECT id FROM public.profiles WHERE is_bot)
  AND a.route_preview->>'kind' = 'route'
  AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(a.route_preview->'points') p
      WHERE jsonb_typeof(p) <> 'array'
  );

-- Self-check: fail the migration if any bot preview point is not a 2-element array.
DO $$
DECLARE bad INTEGER;
BEGIN
    SELECT count(*) INTO bad
    FROM public.activities a, jsonb_array_elements(a.route_preview->'points') p
    WHERE a.user_id IN (SELECT id FROM public.profiles WHERE is_bot)
      AND a.route_preview->>'kind' = 'route'
      AND (jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) <> 2);
    IF bad > 0 THEN
        RAISE EXCEPTION 'bot route_preview has % malformed points', bad;
    END IF;
END $$;
