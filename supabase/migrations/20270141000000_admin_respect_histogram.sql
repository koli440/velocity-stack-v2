-- Admin dashboard: Respect tiers. Admin-only SECURITY DEFINER RPC returning a histogram of Respect per activity
-- (how many activities have exactly N Respects, all time). Tier names/thresholds live only in src/lib/respectLevel.js
-- and are bucketed in JS. Aggregates only (no ids/names); same rules as admin_respect_stats: reactions of type
-- 'respect' by non-bot users on non-bot activities of non-bot owners. Additive and idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.admin_respect_histogram()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE
    v_out JSONB;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('count', n, 'activities', c) ORDER BY n), '[]'::jsonb)
      INTO v_out
      FROM (
        SELECT n, COUNT(*) AS c
          FROM (
            SELECT r.activity_id, COUNT(*) AS n
              FROM public.activity_reactions r
              JOIN public.activities a ON a.id = r.activity_id
              JOIN public.profiles pr ON pr.id = r.user_id AND NOT pr.is_bot
              JOIN public.profiles po ON po.id = a.user_id AND NOT po.is_bot
             WHERE r.type = 'respect' AND a.source <> 'bot'
             GROUP BY r.activity_id
          ) per_activity
         GROUP BY n
      ) h;

    RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_respect_histogram() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_respect_histogram() TO authenticated;
