-- Per-package free period (trial days) for subscription packages. Additive and idempotent.

ALTER TABLE public.coach_packages ADD COLUMN IF NOT EXISTS trial_days INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.coach_packages DROP CONSTRAINT IF EXISTS coach_packages_trial_days_check;

ALTER TABLE public.coach_packages ADD CONSTRAINT coach_packages_trial_days_check CHECK (trial_days BETWEEN 0 AND 90 AND (trial_days = 0 OR kind = 'subscription'));

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
        'packages', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'description', k.description, 'kind', k.kind,
                                                'interval', k.billing_interval, 'amount_cents', k.amount_cents, 'currency', k.currency, 'trial_days', k.trial_days)
                             ORDER BY k.position, k.created_at)
            FROM public.coach_packages k WHERE k.coach_id = c.coach_id AND k.is_active), '[]'::JSONB)
    )
    FROM public.coach_cards c JOIN public.profiles p ON p.id = c.coach_id
    WHERE c.coach_id = p_coach
$$;
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
        'logo_url', v_card.logo_url, 'banner_url', v_card.banner_url,
        'is_public', v_card.is_public, 'is_listed', v_card.is_listed, 'accepting_athletes', v_card.accepting_athletes,
        'max_athletes', v_card.max_athletes,
        'packages', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'description', k.description, 'kind', k.kind,
                                                'interval', k.billing_interval, 'amount_cents', k.amount_cents,
                                                'currency', k.currency, 'trial_days', k.trial_days, 'is_active', k.is_active)
                             ORDER BY k.position, k.created_at)
            FROM public.coach_packages k WHERE k.coach_id = v_card.coach_id), '[]'::JSONB));
END;
$$;
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
    v_trial INTEGER;
    v_has_logo BOOLEAN := p ? 'logo_url';
    v_has_banner BOOLEAN := p ? 'banner_url';
    v_logo TEXT := NULLIF(btrim(COALESCE(p->>'logo_url', '')), '');
    v_banner TEXT := NULLIF(btrim(COALESCE(p->>'banner_url', '')), '');
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
    IF v_logo IS NOT NULL AND v_logo !~ ('^https://[^/?#@]+/storage/v1/object/public/coach-media/' || v_me::text || '/logo-[0-9]+\.(jpg|png|webp)$') THEN
        RAISE EXCEPTION 'Invalid logo image';
    END IF;
    IF v_banner IS NOT NULL AND v_banner !~ ('^https://[^/?#@]+/storage/v1/object/public/coach-media/' || v_me::text || '/banner-[0-9]+\.(jpg|png|webp)$') THEN
        RAISE EXCEPTION 'Invalid banner image';
    END IF;
    DELETE FROM public.coach_card_edit_log WHERE at < NOW() - INTERVAL '1 day';
    IF (SELECT count(*) FROM public.coach_card_edit_log WHERE coach_id = v_me AND at > NOW() - INTERVAL '1 hour') >= 60 THEN
        RAISE EXCEPTION 'Too many edits, try again later';
    END IF;
    INSERT INTO public.coach_card_edit_log (coach_id) VALUES (v_me);

    INSERT INTO public.coach_cards (coach_id, slug, headline, bio, accent, disciplines, languages, location,
                                    accepting_athletes, max_athletes, logo_url, banner_url)
        VALUES (v_me, v_slug, btrim(COALESCE(p->>'headline', '')), btrim(COALESCE(p->>'bio', '')),
                COALESCE(NULLIF(p->>'accent', ''), 'orange'), v_disc, v_lang, btrim(COALESCE(p->>'location', '')),
                COALESCE((p->>'accepting_athletes')::BOOLEAN, TRUE), v_max, v_logo, v_banner)
        ON CONFLICT (coach_id) DO UPDATE SET
            slug = EXCLUDED.slug, headline = EXCLUDED.headline, bio = EXCLUDED.bio, accent = EXCLUDED.accent,
            disciplines = EXCLUDED.disciplines, languages = EXCLUDED.languages, location = EXCLUDED.location,
            accepting_athletes = EXCLUDED.accepting_athletes, max_athletes = EXCLUDED.max_athletes,
            logo_url = CASE WHEN v_has_logo THEN EXCLUDED.logo_url ELSE public.coach_cards.logo_url END,
            banner_url = CASE WHEN v_has_banner THEN EXCLUDED.banner_url ELSE public.coach_cards.banner_url END,
            updated_at = NOW();

    FOR v_pkg IN SELECT * FROM jsonb_array_elements(v_pkgs) LOOP
        v_pid := NULLIF(v_pkg->>'id', '')::UUID;
        v_kind := v_pkg->>'kind';
        v_amount := CASE WHEN v_kind = 'free' THEN NULL ELSE NULLIF(v_pkg->>'amount_cents', '')::INTEGER END;
        v_trial := CASE WHEN v_kind = 'subscription' THEN COALESCE(NULLIF(v_pkg->>'trial_days', '')::INTEGER, 0) ELSE 0 END;
        IF v_trial < 0 OR v_trial > 90 THEN RAISE EXCEPTION 'Free period must be between 0 and 90 days'; END IF;
        IF v_pid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.coach_packages WHERE id = v_pid AND coach_id = v_me) THEN
            RAISE EXCEPTION 'No such package';
        END IF;
        IF v_pid IS NULL THEN
            INSERT INTO public.coach_packages (coach_id, title, description, kind, billing_interval, amount_cents, currency, position, is_active, trial_days)
                VALUES (v_me, btrim(COALESCE(v_pkg->>'title', '')), btrim(COALESCE(v_pkg->>'description', '')), v_kind,
                        CASE WHEN v_kind = 'subscription' THEN v_pkg->>'interval' END, v_amount,
                        COALESCE(NULLIF(v_pkg->>'currency', ''), 'eur'), v_pos, COALESCE((v_pkg->>'is_active')::BOOLEAN, TRUE), v_trial)
                RETURNING id INTO v_pid;
        ELSE
            UPDATE public.coach_packages SET title = btrim(COALESCE(v_pkg->>'title', '')), description = btrim(COALESCE(v_pkg->>'description', '')),
                   kind = v_kind, billing_interval = CASE WHEN v_kind = 'subscription' THEN v_pkg->>'interval' END,
                   amount_cents = v_amount, currency = COALESCE(NULLIF(v_pkg->>'currency', ''), 'eur'),
                   position = v_pos, is_active = COALESCE((v_pkg->>'is_active')::BOOLEAN, TRUE), trial_days = v_trial
                WHERE id = v_pid;
        END IF;
        v_keep := v_keep || v_pid;
        v_pos := v_pos + 1;
    END LOOP;
    DELETE FROM public.coach_packages WHERE coach_id = v_me AND NOT (id = ANY (v_keep));
    RETURN v_slug;
END;
$$;
CREATE OR REPLACE FUNCTION public.coach_apply_info(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_coach UUID;
    v_card public.coach_cards;
    v_me UUID := auth.uid();
    v_sub public.onboarding_submissions;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    SELECT * INTO v_card FROM public.coach_cards WHERE slug = lower(COALESCE(p_slug, '')) AND is_public;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_coach := v_card.coach_id;
    IF NOT public.coach_module_enabled(v_coach) OR public.is_blocked_between(v_me, v_coach) THEN RETURN NULL; END IF;
    SELECT * INTO v_sub FROM public.onboarding_submissions WHERE coach_id = v_coach AND rider_id = v_me;
    RETURN jsonb_build_object(
        'slug', v_card.slug,
        'name', (SELECT public.profile_display_name(p.nickname, p.first_name, p.last_name) FROM public.profiles p WHERE p.id = v_coach),
        'accent', v_card.accent,
        'is_self', v_me = v_coach,
        'accepting_athletes', v_card.accepting_athletes
            AND (v_card.max_athletes IS NULL OR (SELECT count(*) FROM public.coaching_relationships r WHERE r.coach_id = v_coach AND r.status = 'active') < v_card.max_athletes),
        'has_active_coach', EXISTS (SELECT 1 FROM public.coaching_relationships r WHERE r.rider_id = v_me AND r.status = 'active'),
        'questions', COALESCE((SELECT jsonb_agg(jsonb_build_object('position', q.position, 'question', q.question) ORDER BY q.position)
                               FROM public.coach_card_questions q WHERE q.coach_id = v_coach), '[]'::JSONB),
        'submission_id', v_sub.id,
        'submission_status', CASE WHEN v_sub.id IS NULL THEN NULL ELSE v_sub.status END,
        'package_id', v_sub.package_id,
        'packages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'description', k.description, 'kind', k.kind,
                                                                   'interval', k.billing_interval, 'amount_cents', k.amount_cents, 'currency', k.currency, 'trial_days', k.trial_days)
                                                ORDER BY k.position, k.created_at)
                              FROM public.coach_packages k WHERE k.coach_id = v_coach AND k.is_active), '[]'::JSONB));
END $$;
CREATE OR REPLACE FUNCTION public.my_payment_due()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('relationship_id', r.id, 'coach_id', r.coach_id, 'package_id', k.id, 'title', k.title,
                                            'kind', k.kind, 'interval', k.billing_interval, 'amount_cents', k.amount_cents, 'currency', k.currency, 'trial_days', k.trial_days))
        FROM public.coaching_relationships r
        JOIN public.onboarding_submissions s ON s.coach_id = r.coach_id AND s.rider_id = r.rider_id AND s.status = 'submitted'
        JOIN public.coach_packages k ON k.id = s.package_id AND k.is_active AND k.kind <> 'free'
        WHERE r.rider_id = auth.uid() AND r.status = 'active'
          AND public.coach_module_enabled(r.coach_id) AND public.coach_module_enabled(r.rider_id)
          AND NOT EXISTS (SELECT 1 FROM public.coach_subscriptions cs WHERE cs.rider_id = r.rider_id AND cs.coach_id = r.coach_id
                          AND cs.status IN ('active', 'trialing', 'past_due', 'incomplete'))
          AND NOT (k.kind = 'one_time' AND EXISTS (SELECT 1 FROM public.payments_ledger pl WHERE pl.rider_id = r.rider_id
                          AND pl.coach_id = r.coach_id AND pl.kind = 'payment' AND pl.created_at >= COALESCE(r.responded_at, r.created_at)))
    ), '[]'::JSONB);
END $$;
CREATE OR REPLACE FUNCTION public.billing_checkout_context(p_rider UUID, p_package UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    pk public.coach_packages;
    a public.coach_billing_accounts;
    v_rel UUID;
    v_dob TEXT;
BEGIN
    SELECT * INTO pk FROM public.coach_packages WHERE id = p_package AND is_active AND kind <> 'free';
    IF NOT FOUND OR pk.amount_cents IS NULL OR pk.amount_cents < 50 THEN RAISE EXCEPTION 'Package not available'; END IF;
    IF pk.coach_id = p_rider THEN RAISE EXCEPTION 'You cannot buy your own package'; END IF;
    IF NOT public.coach_module_enabled(pk.coach_id) OR NOT public.coach_module_enabled(p_rider)
       OR public.is_blocked_between(p_rider, pk.coach_id)
       OR NOT EXISTS (SELECT 1 FROM public.coach_cards WHERE coach_id = pk.coach_id AND is_public) THEN
        RAISE EXCEPTION 'Package not available';
    END IF;
    SELECT * INTO a FROM public.coach_billing_accounts WHERE coach_id = pk.coach_id;
    IF NOT FOUND OR NOT a.charges_enabled THEN RAISE EXCEPTION 'This coach cannot take payments yet'; END IF;
    SELECT id INTO v_rel FROM public.coaching_relationships WHERE coach_id = pk.coach_id AND rider_id = p_rider AND status = 'active';
    IF v_rel IS NULL THEN RAISE EXCEPTION 'Payment opens once your coach has accepted you'; END IF;
    SELECT s.answers #>> '{about,dob}' INTO v_dob FROM public.onboarding_submissions s
        WHERE s.coach_id = pk.coach_id AND s.rider_id = p_rider;
    IF v_dob ~ '^\d{4}-\d{2}-\d{2}$' AND date_part('year', age(CURRENT_DATE, v_dob::DATE)) < 18 THEN
        RAISE EXCEPTION 'Online payment is not available for athletes under 18';
    END IF;
    RETURN jsonb_build_object('coach_id', pk.coach_id, 'relationship_id', v_rel, 'stripe_account_id', a.stripe_account_id,
        'package_id', pk.id, 'title', pk.title, 'kind', pk.kind, 'interval', pk.billing_interval,
        'amount_cents', pk.amount_cents, 'currency', pk.currency, 'trial_days', pk.trial_days);
END $$;
