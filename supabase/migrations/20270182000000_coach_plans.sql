-- Coach plans and founding coaches (docs/coach-plans.md). Dark by default: nothing is charged and nothing is
-- enforced until an admin turns coach_plans_enforced on. Platform subscription billing for coach plans is OUT of scope.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.coach_plan_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    enforced BOOLEAN NOT NULL DEFAULT FALSE,
    founding_cap INTEGER NOT NULL DEFAULT 20 CHECK (founding_cap BETWEEN 0 AND 1000),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.coach_plan_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- max_athletes NULL = unlimited. price_cents is informational (placeholder, never charged).
CREATE TABLE IF NOT EXISTS public.coach_plan_tiers (
    tier_key TEXT PRIMARY KEY CHECK (tier_key ~ '^[a-z0-9_]{2,30}$'),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
    max_athletes INTEGER CHECK (max_athletes IS NULL OR max_athletes BETWEEN 0 AND 10000),
    price_cents INTEGER CHECK (price_cents IS NULL OR price_cents BETWEEN 0 AND 1000000),
    position INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO public.coach_plan_tiers (tier_key, name, max_athletes, price_cents, position) VALUES
    ('free', 'Free', 3, 0, 0),
    ('roster_10', 'Roster 10', 10, NULL, 1),
    ('roster_25', 'Roster 25', 25, NULL, 2),
    ('roster_unlimited', 'Roster Unlimited', NULL, NULL, 3)
ON CONFLICT (tier_key) DO NOTHING;

-- Tier and price are snapshotted at grant time so later tier edits never downgrade a founder.
CREATE TABLE IF NOT EXISTS public.coach_founders (
    coach_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    tier_key TEXT NOT NULL,
    locked_max_athletes INTEGER,
    locked_price_cents INTEGER,
    granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.coach_plan_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_plan_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_founders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_plan_settings, public.coach_plan_tiers, public.coach_founders FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coach_plan_active_count(p_coach UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*)::INTEGER FROM public.coaching_relationships WHERE coach_id = p_coach AND status = 'active'
$$;

-- Effective limit: NULL = unlimited. Founders keep their locked limit; everyone else is on the Free tier.
CREATE OR REPLACE FUNCTION public.coach_plan_limit(p_coach UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.coach_founders WHERE coach_id = p_coach)
                THEN (SELECT locked_max_athletes FROM public.coach_founders WHERE coach_id = p_coach)
                ELSE (SELECT max_athletes FROM public.coach_plan_tiers WHERE tier_key = 'free') END
$$;

CREATE OR REPLACE FUNCTION public.coach_plan_can_accept(p_coach UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_limit INTEGER;
BEGIN
    IF NOT COALESCE((SELECT enforced FROM public.coach_plan_settings WHERE id), FALSE) THEN RETURN TRUE; END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_coach AND is_bot) THEN RETURN TRUE; END IF;
    IF EXISTS (SELECT 1 FROM public.coach_founders WHERE coach_id = p_coach AND locked_max_athletes IS NULL) THEN RETURN TRUE; END IF;
    v_limit := public.coach_plan_limit(p_coach);
    RETURN v_limit IS NULL OR public.coach_plan_active_count(p_coach) < v_limit;
END $$;
REVOKE ALL ON FUNCTION public.coach_plan_active_count(UUID), public.coach_plan_limit(UUID), public.coach_plan_can_accept(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_coach_plan()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_f public.coach_founders;
BEGIN
    PERFORM public.coach_module_require();
    SELECT * INTO v_f FROM public.coach_founders WHERE coach_id = v_me;
    RETURN jsonb_build_object(
        'enforced', COALESCE((SELECT enforced FROM public.coach_plan_settings WHERE id), FALSE),
        'founding', v_f.coach_id IS NOT NULL,
        'tier_key', CASE WHEN v_f.coach_id IS NOT NULL THEN v_f.tier_key ELSE 'free' END,
        'tier_name', COALESCE((SELECT name FROM public.coach_plan_tiers WHERE tier_key = CASE WHEN v_f.coach_id IS NOT NULL THEN v_f.tier_key ELSE 'free' END),
                              CASE WHEN v_f.coach_id IS NOT NULL THEN 'Founding coach' ELSE 'Free' END),
        'limit', public.coach_plan_limit(v_me),
        'active', public.coach_plan_active_count(v_me),
        'can_accept', public.coach_plan_can_accept(v_me),
        'tiers', COALESCE((SELECT jsonb_agg(jsonb_build_object('tier_key', t.tier_key, 'name', t.name, 'max_athletes', t.max_athletes, 'price_cents', t.price_cents)
                                            ORDER BY t.position, t.tier_key) FROM public.coach_plan_tiers t WHERE t.is_active), '[]'::JSONB));
END $$;

CREATE OR REPLACE FUNCTION public.admin_coach_plans_status()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
    RETURN jsonb_build_object(
        'enforced', (SELECT enforced FROM public.coach_plan_settings WHERE id),
        'founding_cap', (SELECT founding_cap FROM public.coach_plan_settings WHERE id),
        'founding_count', (SELECT count(*) FROM public.coach_founders),
        'tiers', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.position, t.tier_key) FROM public.coach_plan_tiers t), '[]'::JSONB),
        'founders', COALESCE((SELECT jsonb_agg(jsonb_build_object('coach_id', f.coach_id, 'name', public.profile_display_name(p.nickname, p.first_name, p.last_name),
                       'tier_key', f.tier_key, 'locked_max_athletes', f.locked_max_athletes, 'locked_price_cents', f.locked_price_cents, 'granted_at', f.granted_at)
                       ORDER BY f.granted_at) FROM public.coach_founders f LEFT JOIN public.profiles p ON p.id = f.coach_id), '[]'::JSONB));
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_coach_plans(p_enforced BOOLEAN, p_founding_cap INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
    IF p_founding_cap IS NOT NULL AND (p_founding_cap < 0 OR p_founding_cap > 1000) THEN RAISE EXCEPTION 'Invalid founding cap'; END IF;
    UPDATE public.coach_plan_settings
        SET enforced = COALESCE(p_enforced, enforced), founding_cap = COALESCE(p_founding_cap, founding_cap), updated_at = NOW() WHERE id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_coach_plan_tier(p_key TEXT, p_name TEXT, p_max_athletes INTEGER, p_price_cents INTEGER, p_position INTEGER, p_active BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
    IF p_key = 'free' AND (p_max_athletes IS NULL OR NOT COALESCE(p_active, TRUE)) THEN RAISE EXCEPTION 'The Free tier needs a limit and stays active'; END IF;
    INSERT INTO public.coach_plan_tiers (tier_key, name, max_athletes, price_cents, position, is_active)
        VALUES (p_key, btrim(p_name), p_max_athletes, p_price_cents, COALESCE(p_position, 0), COALESCE(p_active, TRUE))
    ON CONFLICT (tier_key) DO UPDATE SET name = EXCLUDED.name, max_athletes = EXCLUDED.max_athletes, price_cents = EXCLUDED.price_cents,
        position = EXCLUDED.position, is_active = EXCLUDED.is_active;
END $$;

CREATE OR REPLACE FUNCTION public.admin_grant_founder(p_coach UUID, p_tier TEXT, p_price_cents INTEGER DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_tier public.coach_plan_tiers;
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('coach_founders'));
    IF NOT EXISTS (SELECT 1 FROM public.coach_cards WHERE coach_id = p_coach) THEN RAISE EXCEPTION 'That user has no coach card'; END IF;
    SELECT * INTO v_tier FROM public.coach_plan_tiers WHERE tier_key = p_tier;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown tier'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.coach_founders WHERE coach_id = p_coach)
       AND (SELECT count(*) FROM public.coach_founders) >= (SELECT founding_cap FROM public.coach_plan_settings WHERE id) THEN
        RAISE EXCEPTION 'Founding coach cap reached';
    END IF;
    INSERT INTO public.coach_founders (coach_id, tier_key, locked_max_athletes, locked_price_cents, granted_by)
        VALUES (p_coach, v_tier.tier_key, v_tier.max_athletes, COALESCE(p_price_cents, v_tier.price_cents), auth.uid())
    ON CONFLICT (coach_id) DO UPDATE SET tier_key = EXCLUDED.tier_key, locked_max_athletes = EXCLUDED.locked_max_athletes,
        locked_price_cents = EXCLUDED.locked_price_cents, granted_by = EXCLUDED.granted_by;
END $$;

CREATE OR REPLACE FUNCTION public.admin_revoke_founder(p_coach UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
    DELETE FROM public.coach_founders WHERE coach_id = p_coach;
END $$;

REVOKE ALL ON FUNCTION public.my_coach_plan(), public.admin_coach_plans_status(), public.admin_set_coach_plans(BOOLEAN, INTEGER),
    public.admin_set_coach_plan_tier(TEXT, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN), public.admin_grant_founder(UUID, TEXT, INTEGER),
    public.admin_revoke_founder(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_coach_plan(), public.admin_coach_plans_status(), public.admin_set_coach_plans(BOOLEAN, INTEGER),
    public.admin_set_coach_plan_tier(TEXT, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN), public.admin_grant_founder(UUID, TEXT, INTEGER),
    public.admin_revoke_founder(UUID) TO authenticated;

-- Public card and directory expose only a "founding" boolean.
CREATE OR REPLACE FUNCTION public.coach_card_json(p_coach UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'coach_id', c.coach_id,
        'slug', c.slug,
        'name', public.profile_display_name(p.nickname, p.first_name, p.last_name),
        'avatar_url', CASE WHEN BTRIM(p.avatar_url) ~ '^https://[^/?#@]+/storage/v1/object/public/avatars/' THEN BTRIM(p.avatar_url) END,
        'logo_url', c.logo_url,
        'banner_url', c.banner_url,
        'headline', c.headline,
        'bio', c.bio,
        'accent', c.accent,
        'disciplines', c.disciplines,
        'languages', c.languages,
        'location', c.location,
        'accepting_athletes', c.accepting_athletes,
        'waitlist', c.max_athletes IS NOT NULL AND (
            SELECT count(*) FROM public.coaching_relationships r WHERE r.coach_id = c.coach_id AND r.status = 'active') >= c.max_athletes,
        'licence', public.coach_licence_public(c.coach_id),
        'founding', EXISTS (SELECT 1 FROM public.coach_founders f WHERE f.coach_id = c.coach_id),
        'packages', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'description', k.description, 'kind', k.kind,
                                                'interval', k.billing_interval, 'amount_cents', k.amount_cents, 'currency', k.currency, 'trial_days', k.trial_days)
                             ORDER BY k.position, k.created_at)
            FROM public.coach_packages k WHERE k.coach_id = c.coach_id AND k.is_active), '[]'::JSONB)
    )
    FROM public.coach_cards c JOIN public.profiles p ON p.id = c.coach_id
    WHERE c.coach_id = p_coach
$$;
CREATE OR REPLACE FUNCTION public.coaching_accept_as(p_id UUID, p_actor UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_rider UUID;
    r public.coaching_relationships;
    v_old public.coaching_relationships;
    v_prev_sub TEXT;
    v_prev_claims TEXT;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    SELECT rider_id INTO v_rider FROM public.coaching_relationships WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such coaching request';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('coaching:' || v_rider::text));

    SELECT * INTO r FROM public.coaching_relationships WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR r.status <> 'pending' OR r.initiated_by = p_actor
       OR p_actor NOT IN (r.coach_id, r.rider_id) THEN
        RAISE EXCEPTION 'No such coaching request';
    END IF;
    IF public.is_blocked_between(r.coach_id, r.rider_id) THEN
        UPDATE public.coaching_relationships
            SET status = 'ended', ended_at = NOW(), ended_by = p_actor WHERE id = r.id;
        RAISE EXCEPTION 'No such coaching request';
    END IF;

    -- Plan limit (dark until coach_plans_enforced): only NEW acceptances are blocked, never existing athletes.
    IF NOT public.coach_plan_can_accept(r.coach_id) THEN
        RAISE EXCEPTION 'Coach plan athlete limit reached';
    END IF;

    SELECT * INTO v_old FROM public.coaching_relationships
        WHERE rider_id = r.rider_id AND status = 'active' FOR UPDATE;
    IF FOUND THEN
        IF p_actor <> r.rider_id THEN
            RAISE EXCEPTION 'This rider already has a coach';
        END IF;
        UPDATE public.coaching_relationships
            SET status = 'ended', ended_at = NOW(), ended_by = p_actor WHERE id = v_old.id;
        INSERT INTO public.notifications (user_id, actor_id, type)
            VALUES (v_old.coach_id, p_actor, 'coach_replaced');
    END IF;

    UPDATE public.coaching_relationships
        SET status = 'active', responded_at = NOW() WHERE id = r.id;
    -- An accepted application with a paid package asks the athlete to pay instead of the plain "accepted" notification.
    IF p_actor = r.coach_id AND EXISTS (
        SELECT 1 FROM public.onboarding_submissions s JOIN public.coach_packages k ON k.id = s.package_id
        WHERE s.coach_id = r.coach_id AND s.rider_id = r.rider_id AND s.status = 'submitted' AND k.is_active AND k.kind <> 'free') THEN
        INSERT INTO public.notifications (user_id, actor_id, type) VALUES (r.rider_id, p_actor, 'payment_requested');
    ELSE
        INSERT INTO public.notifications (user_id, actor_id, type)
            VALUES (r.initiated_by, p_actor, 'coach_accepted');
    END IF;

    v_prev_sub := current_setting('request.jwt.claim.sub', true);
    v_prev_claims := current_setting('request.jwt.claims', true);
    BEGIN
        PERFORM public.apply_onboarding_setup(r.id);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), TRUE);
        PERFORM set_config('request.jwt.claims', COALESCE(v_prev_claims, ''), TRUE);
    END;
END;
$$;
DROP FUNCTION IF EXISTS public.list_coaches(TEXT, TEXT, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.list_coaches(p_search TEXT DEFAULT NULL, p_discipline TEXT DEFAULT NULL,
                                                p_limit INTEGER DEFAULT 24, p_offset INTEGER DEFAULT 0,
                                                p_verified_only BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_q TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
    v_like TEXT;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
    IF v_q IS NOT NULL THEN
        v_q := left(v_q, 60);
        v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(row_to_json(t)::JSONB ORDER BY t.name, t.slug)
        FROM (
            SELECT c.slug, public.profile_display_name(p.nickname, p.first_name, p.last_name) AS name,
                   CASE WHEN BTRIM(p.avatar_url) ~ '^https://[^/?#@]+/storage/v1/object/public/avatars/' THEN BTRIM(p.avatar_url) END AS avatar_url,
                   c.logo_url, c.banner_url,
                   c.headline, c.accent, c.disciplines, c.languages, c.location, c.accepting_athletes,
                   EXISTS (SELECT 1 FROM public.coach_founders f WHERE f.coach_id = c.coach_id) AS founding,
                   (SELECT jsonb_build_object('verified', TRUE, 'body', b.name, 'level', l.level)
                      FROM public.coach_licences l JOIN public.licence_bodies b ON b.id = l.body_id
                     WHERE l.coach_id = c.coach_id AND l.status = 'verified' AND (l.valid_until IS NULL OR l.valid_until >= CURRENT_DATE)) AS licence
            FROM public.coach_cards c JOIN public.profiles p ON p.id = c.coach_id
            WHERE c.is_public AND c.is_listed AND public.coach_module_enabled(c.coach_id)
              AND (auth.uid() IS NULL OR auth.uid() = c.coach_id OR NOT public.is_blocked_between(auth.uid(), c.coach_id))
              AND (NOT COALESCE(p_verified_only, FALSE) OR EXISTS (
                       SELECT 1 FROM public.coach_licences l WHERE l.coach_id = c.coach_id AND l.status = 'verified'
                          AND (l.valid_until IS NULL OR l.valid_until >= CURRENT_DATE)))
              AND (p_discipline IS NULL OR p_discipline = ANY (c.disciplines))
              AND (v_like IS NULL OR public.profile_display_name(p.nickname, p.first_name, p.last_name) ILIKE v_like
                   OR c.headline ILIKE v_like OR c.location ILIKE v_like
                   OR EXISTS (SELECT 1 FROM unnest(c.disciplines || c.languages) x WHERE x ILIKE v_like))
            ORDER BY public.profile_display_name(p.nickname, p.first_name, p.last_name), c.slug
            LIMIT v_limit OFFSET v_offset
        ) t
    ), '[]'::JSONB);
END;
$$;
REVOKE ALL ON FUNCTION public.list_coaches(TEXT, TEXT, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_coaches(TEXT, TEXT, INTEGER, INTEGER, BOOLEAN) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.coach_card_json(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.coaching_accept_as(UUID, UUID) FROM PUBLIC, anon, authenticated;
