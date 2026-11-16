-- Coach module, phase 1b: coach card (public page /c/<slug>), text packages, opt-in directory, reports.
--
--  * Tables are not client accessible (no RLS policies, all privileges revoked); every read/write is a SECURITY
--    DEFINER RPC that checks the `coach_module` flag (docs/coaching.md). The public page and directory only show
--    cards whose coach has the module enabled, so everything stays dark until the flag is on.
--  * get_coach_card(slug) and list_coaches() are anon-callable and return public columns only (no email, no ids
--    except coach_id, no stripe ids). A card is public only when the coach published it; the directory additionally
--    needs the coach's explicit `is_listed` opt-in.
--  * Blocks: a signed-in viewer blocked by (or blocking) the coach gets "not found".
--  * Writes are rate limited (60 card edits per hour, 5 reports per day per reporter).
-- All objects are additive and idempotent.

CREATE TABLE IF NOT EXISTS public.coach_cards (
    coach_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
    headline TEXT NOT NULL DEFAULT '' CHECK (char_length(headline) <= 80),
    bio TEXT NOT NULL DEFAULT '' CHECK (char_length(bio) <= 1500),
    accent TEXT NOT NULL DEFAULT 'orange' CHECK (accent IN ('orange', 'emerald', 'sky', 'violet', 'rose', 'amber', 'teal', 'slate')),
    disciplines TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(disciplines) <= 8),
    languages TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(languages) <= 8),
    location TEXT NOT NULL DEFAULT '' CHECK (char_length(location) <= 60),
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    is_listed BOOLEAN NOT NULL DEFAULT FALSE,
    accepting_athletes BOOLEAN NOT NULL DEFAULT TRUE,
    max_athletes INTEGER CHECK (max_athletes IS NULL OR max_athletes BETWEEN 1 AND 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (NOT is_listed OR is_public)
);

CREATE TABLE IF NOT EXISTS public.coach_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id UUID NOT NULL REFERENCES public.coach_cards(coach_id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 300),
    kind TEXT NOT NULL CHECK (kind IN ('subscription', 'one_time', 'free')),
    billing_interval TEXT CHECK (billing_interval IN ('month', 'quarter', 'year')),
    amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents BETWEEN 0 AND 1000000),
    currency TEXT NOT NULL DEFAULT 'eur' CHECK (currency IN ('eur', 'gbp', 'usd')),
    position INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    stripe_product_id TEXT,
    stripe_price_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((kind = 'subscription') = (billing_interval IS NOT NULL)),
    CHECK (kind <> 'free' OR amount_cents IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_coach_packages_coach ON public.coach_packages (coach_id, position);

CREATE TABLE IF NOT EXISTS public.coach_card_edit_log (
    coach_id UUID NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coach_card_edit_log ON public.coach_card_edit_log (coach_id, at);

CREATE TABLE IF NOT EXISTS public.coach_card_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id UUID NOT NULL REFERENCES public.coach_cards(coach_id) ON DELETE CASCADE,
    reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    UNIQUE (coach_id, reporter_id)
);

ALTER TABLE public.coach_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_card_edit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_card_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_cards, public.coach_packages, public.coach_card_edit_log, public.coach_card_reports
    FROM PUBLIC, anon, authenticated;

-- Slugs that must never be claimed (routes and obvious impersonation targets).
CREATE OR REPLACE FUNCTION public.coach_slug_reserved(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT p_slug = ANY (ARRAY['admin', 'api', 'coach', 'coaches', 'c', 'riders', 'rider', 'login', 'register', 'settings',
        'about', 'blog', 'privacy', 'terms', 'apply', 'app', 'auth', 'www', 'help', 'support', 'velocitystack',
        'velocity-stack', 'official', 'team', 'staff', 'null', 'undefined', 'new', 'edit'])
$$;

-- Public columns of a card as JSON. NULL when the card is not publicly visible to the caller.
CREATE OR REPLACE FUNCTION public.coach_card_json(p_coach UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'coach_id', c.coach_id,
        'slug', c.slug,
        'name', public.profile_display_name(p.nickname, p.first_name, p.last_name),
        'avatar_url', CASE WHEN BTRIM(p.avatar_url) ~ '^https://[^/?#@]+/storage/v1/object/public/avatars/' THEN BTRIM(p.avatar_url) END,
        'headline', c.headline,
        'bio', c.bio,
        'accent', c.accent,
        'disciplines', c.disciplines,
        'languages', c.languages,
        'location', c.location,
        'accepting_athletes', c.accepting_athletes,
        'waitlist', c.max_athletes IS NOT NULL AND (
            SELECT count(*) FROM public.coaching_relationships r WHERE r.coach_id = c.coach_id AND r.status = 'active') >= c.max_athletes,
        'packages', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'description', k.description, 'kind', k.kind,
                                                'interval', k.billing_interval, 'amount_cents', k.amount_cents, 'currency', k.currency)
                             ORDER BY k.position, k.created_at)
            FROM public.coach_packages k WHERE k.coach_id = c.coach_id AND k.is_active), '[]'::JSONB)
    )
    FROM public.coach_cards c JOIN public.profiles p ON p.id = c.coach_id
    WHERE c.coach_id = p_coach
$$;
REVOKE ALL ON FUNCTION public.coach_card_json(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_coach_card(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_coach UUID;
BEGIN
    SELECT coach_id INTO v_coach FROM public.coach_cards WHERE slug = lower(COALESCE(p_slug, '')) AND is_public;
    IF v_coach IS NULL OR NOT public.coach_module_enabled(v_coach) THEN
        RETURN NULL;
    END IF;
    IF auth.uid() IS NOT NULL AND auth.uid() <> v_coach AND public.is_blocked_between(auth.uid(), v_coach) THEN
        RETURN NULL;
    END IF;
    RETURN public.coach_card_json(v_coach);
END;
$$;

-- Opt-in directory: public + listed cards of coaches with the module. Search matches name, headline, location,
-- disciplines and languages (case-insensitive, wildcards escaped).
CREATE OR REPLACE FUNCTION public.list_coaches(p_search TEXT DEFAULT NULL, p_discipline TEXT DEFAULT NULL,
                                                p_limit INTEGER DEFAULT 24, p_offset INTEGER DEFAULT 0)
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
                   c.headline, c.accent, c.disciplines, c.languages, c.location, c.accepting_athletes
            FROM public.coach_cards c JOIN public.profiles p ON p.id = c.coach_id
            WHERE c.is_public AND c.is_listed AND public.coach_module_enabled(c.coach_id)
              AND (auth.uid() IS NULL OR auth.uid() = c.coach_id OR NOT public.is_blocked_between(auth.uid(), c.coach_id))
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

-- The coach's own card (also unpublished) with every package.
CREATE OR REPLACE FUNCTION public.my_coach_card()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_card public.coach_cards;
BEGIN
    PERFORM public.coach_module_require();
    SELECT * INTO v_card FROM public.coach_cards WHERE coach_id = auth.uid();
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    RETURN jsonb_build_object(
        'slug', v_card.slug, 'headline', v_card.headline, 'bio', v_card.bio, 'accent', v_card.accent,
        'disciplines', v_card.disciplines, 'languages', v_card.languages, 'location', v_card.location,
        'is_public', v_card.is_public, 'is_listed', v_card.is_listed, 'accepting_athletes', v_card.accepting_athletes,
        'max_athletes', v_card.max_athletes,
        'packages', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'description', k.description, 'kind', k.kind,
                                                'interval', k.billing_interval, 'amount_cents', k.amount_cents,
                                                'currency', k.currency, 'is_active', k.is_active)
                             ORDER BY k.position, k.created_at)
            FROM public.coach_packages k WHERE k.coach_id = v_card.coach_id), '[]'::JSONB));
END;
$$;

CREATE OR REPLACE FUNCTION public.coach_card_slug_available(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_slug TEXT := lower(COALESCE(p_slug, ''));
BEGIN
    PERFORM public.coach_module_require();
    RETURN v_slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' AND NOT public.coach_slug_reserved(v_slug)
        AND NOT EXISTS (SELECT 1 FROM public.coach_cards WHERE slug = v_slug AND coach_id <> auth.uid());
END;
$$;

-- Creates or updates the caller's card. Visibility flags are unchanged here (see set_coach_card_visibility).
-- Packages are synchronised by id: listed ids are updated/created, the rest are deleted.
CREATE OR REPLACE FUNCTION public.save_coach_card(p JSONB)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_slug TEXT := lower(btrim(COALESCE(p->>'slug', '')));
    v_disc TEXT[] := COALESCE(ARRAY(SELECT btrim(x) FROM jsonb_array_elements_text(COALESCE(p->'disciplines', '[]'::JSONB)) x WHERE btrim(x) <> ''), '{}');
    v_lang TEXT[] := COALESCE(ARRAY(SELECT btrim(x) FROM jsonb_array_elements_text(COALESCE(p->'languages', '[]'::JSONB)) x WHERE btrim(x) <> ''), '{}');
    v_max INTEGER := NULLIF(p->>'max_athletes', '')::INTEGER;
    v_pkgs JSONB := COALESCE(p->'packages', '[]'::JSONB);
    v_pkg JSONB;
    v_pid UUID;
    v_pos INTEGER := 0;
    v_keep UUID[] := '{}';
    v_kind TEXT;
    v_amount INTEGER;
BEGIN
    PERFORM public.coach_module_require();
    IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' OR public.coach_slug_reserved(v_slug) THEN
        RAISE EXCEPTION 'Invalid or reserved link name';
    END IF;
    IF EXISTS (SELECT 1 FROM public.coach_cards WHERE slug = v_slug AND coach_id <> v_me) THEN
        RAISE EXCEPTION 'This link name is already taken';
    END IF;
    IF jsonb_typeof(v_pkgs) <> 'array' OR jsonb_array_length(v_pkgs) > 6 THEN
        RAISE EXCEPTION 'At most 6 packages';
    END IF;
    DELETE FROM public.coach_card_edit_log WHERE at < NOW() - INTERVAL '1 day';
    IF (SELECT count(*) FROM public.coach_card_edit_log WHERE coach_id = v_me AND at > NOW() - INTERVAL '1 hour') >= 60 THEN
        RAISE EXCEPTION 'Too many edits, try again later';
    END IF;
    INSERT INTO public.coach_card_edit_log (coach_id) VALUES (v_me);

    INSERT INTO public.coach_cards (coach_id, slug, headline, bio, accent, disciplines, languages, location,
                                    accepting_athletes, max_athletes)
        VALUES (v_me, v_slug, btrim(COALESCE(p->>'headline', '')), btrim(COALESCE(p->>'bio', '')),
                COALESCE(NULLIF(p->>'accent', ''), 'orange'), v_disc, v_lang, btrim(COALESCE(p->>'location', '')),
                COALESCE((p->>'accepting_athletes')::BOOLEAN, TRUE), v_max)
        ON CONFLICT (coach_id) DO UPDATE SET
            slug = EXCLUDED.slug, headline = EXCLUDED.headline, bio = EXCLUDED.bio, accent = EXCLUDED.accent,
            disciplines = EXCLUDED.disciplines, languages = EXCLUDED.languages, location = EXCLUDED.location,
            accepting_athletes = EXCLUDED.accepting_athletes, max_athletes = EXCLUDED.max_athletes, updated_at = NOW();

    FOR v_pkg IN SELECT * FROM jsonb_array_elements(v_pkgs) LOOP
        v_pid := NULLIF(v_pkg->>'id', '')::UUID;
        v_kind := v_pkg->>'kind';
        v_amount := CASE WHEN v_kind = 'free' THEN NULL ELSE NULLIF(v_pkg->>'amount_cents', '')::INTEGER END;
        IF v_pid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.coach_packages WHERE id = v_pid AND coach_id = v_me) THEN
            RAISE EXCEPTION 'No such package';
        END IF;
        IF v_pid IS NULL THEN
            INSERT INTO public.coach_packages (coach_id, title, description, kind, billing_interval, amount_cents, currency, position, is_active)
                VALUES (v_me, btrim(COALESCE(v_pkg->>'title', '')), btrim(COALESCE(v_pkg->>'description', '')), v_kind,
                        CASE WHEN v_kind = 'subscription' THEN v_pkg->>'interval' END, v_amount,
                        COALESCE(NULLIF(v_pkg->>'currency', ''), 'eur'), v_pos, COALESCE((v_pkg->>'is_active')::BOOLEAN, TRUE))
                RETURNING id INTO v_pid;
        ELSE
            UPDATE public.coach_packages SET title = btrim(COALESCE(v_pkg->>'title', '')), description = btrim(COALESCE(v_pkg->>'description', '')),
                   kind = v_kind, billing_interval = CASE WHEN v_kind = 'subscription' THEN v_pkg->>'interval' END,
                   amount_cents = v_amount, currency = COALESCE(NULLIF(v_pkg->>'currency', ''), 'eur'),
                   position = v_pos, is_active = COALESCE((v_pkg->>'is_active')::BOOLEAN, TRUE)
                WHERE id = v_pid;
        END IF;
        v_keep := v_keep || v_pid;
        v_pos := v_pos + 1;
    END LOOP;
    DELETE FROM public.coach_packages WHERE coach_id = v_me AND NOT (id = ANY (v_keep));
    RETURN v_slug;
END;
$$;

-- Publish / unpublish and the directory opt-in. Listing requires a published card; unpublishing also unlists.
CREATE OR REPLACE FUNCTION public.set_coach_card_visibility(p_public BOOLEAN, p_listed BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_public BOOLEAN := COALESCE(p_public, FALSE);
    v_listed BOOLEAN := COALESCE(p_listed, FALSE) AND COALESCE(p_public, FALSE);
BEGIN
    PERFORM public.coach_module_require();
    UPDATE public.coach_cards SET is_public = v_public, is_listed = v_listed, updated_at = NOW() WHERE coach_id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Create your coach card first';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_coach_card(p_slug TEXT, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_coach UUID;
    v_reason TEXT := left(btrim(COALESCE(p_reason, '')), 500);
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF v_reason = '' THEN
        RAISE EXCEPTION 'Please say what is wrong';
    END IF;
    SELECT coach_id INTO v_coach FROM public.coach_cards WHERE slug = lower(COALESCE(p_slug, '')) AND is_public;
    IF v_coach IS NULL OR NOT public.coach_module_enabled(v_coach) THEN
        RAISE EXCEPTION 'Coach card not found';
    END IF;
    IF (SELECT count(*) FROM public.coach_card_reports WHERE reporter_id = auth.uid() AND created_at > NOW() - INTERVAL '1 day') >= 5 THEN
        RAISE EXCEPTION 'Too many reports, try again tomorrow';
    END IF;
    INSERT INTO public.coach_card_reports (coach_id, reporter_id, reason) VALUES (v_coach, auth.uid(), v_reason)
        ON CONFLICT (coach_id, reporter_id) DO UPDATE SET reason = EXCLUDED.reason, status = 'open', created_at = NOW(), resolved_at = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_coach_card_reports()
RETURNS TABLE (id UUID, slug TEXT, coach_name TEXT, reason TEXT, status TEXT, created_at TIMESTAMPTZ, is_public BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin only';
    END IF;
    RETURN QUERY
        SELECT r.id, c.slug, public.profile_display_name(p.nickname, p.first_name, p.last_name), r.reason, r.status, r.created_at, c.is_public
        FROM public.coach_card_reports r
        JOIN public.coach_cards c ON c.coach_id = r.coach_id
        JOIN public.profiles p ON p.id = r.coach_id
        ORDER BY (r.status = 'open') DESC, r.created_at DESC
        LIMIT 200;
END;
$$;

-- Resolve a report; optionally take the card offline (unpublish + unlist).
CREATE OR REPLACE FUNCTION public.admin_resolve_coach_card_report(p_id UUID, p_unpublish BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_coach UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin only';
    END IF;
    UPDATE public.coach_card_reports
        SET status = CASE WHEN COALESCE(p_unpublish, FALSE) THEN 'resolved' ELSE 'dismissed' END, resolved_at = NOW()
        WHERE id = p_id RETURNING coach_id INTO v_coach;
    IF v_coach IS NULL THEN
        RAISE EXCEPTION 'No such report';
    END IF;
    IF COALESCE(p_unpublish, FALSE) THEN
        UPDATE public.coach_cards SET is_public = FALSE, is_listed = FALSE, updated_at = NOW() WHERE coach_id = v_coach;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_coach_card(TEXT), public.list_coaches(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_coach_card(TEXT), public.list_coaches(TEXT, TEXT, INTEGER, INTEGER) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.coach_slug_reserved(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_coach_card(), public.coach_card_slug_available(TEXT), public.save_coach_card(JSONB),
    public.set_coach_card_visibility(BOOLEAN, BOOLEAN), public.report_coach_card(TEXT, TEXT),
    public.admin_coach_card_reports(), public.admin_resolve_coach_card_report(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_coach_card(), public.coach_card_slug_available(TEXT), public.save_coach_card(JSONB),
    public.set_coach_card_visibility(BOOLEAN, BOOLEAN), public.report_coach_card(TEXT, TEXT),
    public.admin_coach_card_reports(), public.admin_resolve_coach_card_report(UUID, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
