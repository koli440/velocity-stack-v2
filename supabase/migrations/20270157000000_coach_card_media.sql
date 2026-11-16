-- Coach card logo and cover banner.
--
--  * coach_cards.logo_url / banner_url: public URLs of objects in the public `coach-media` bucket, strictly under the
--    coach's own <coach_id>/ prefix (CHECK + validation in save_coach_card; no external or tracking images).
--  * `coach-media` bucket: 5 MB, JPEG/PNG/WebP; coaches manage only objects below their own user_id/ prefix
--    (same pattern as the `avatars` bucket).
--  * save_coach_card only touches the images when the keys are present in the payload, so older clients keep them;
--    an empty string (or null) removes the image. get_coach_card / list_coaches / my_coach_card return the URLs.
-- All objects are additive and idempotent.

ALTER TABLE public.coach_cards ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.coach_cards ADD COLUMN IF NOT EXISTS banner_url TEXT;

ALTER TABLE public.coach_cards DROP CONSTRAINT IF EXISTS coach_cards_logo_url_check;
ALTER TABLE public.coach_cards ADD CONSTRAINT coach_cards_logo_url_check CHECK (
    logo_url IS NULL
    OR logo_url ~ ('^https://[^/?#@]+/storage/v1/object/public/coach-media/' || coach_id::text || '/logo-[0-9]+\.(jpg|png|webp)$'));
ALTER TABLE public.coach_cards DROP CONSTRAINT IF EXISTS coach_cards_banner_url_check;
ALTER TABLE public.coach_cards ADD CONSTRAINT coach_cards_banner_url_check CHECK (
    banner_url IS NULL
    OR banner_url ~ ('^https://[^/?#@]+/storage/v1/object/public/coach-media/' || coach_id::text || '/banner-[0-9]+\.(jpg|png|webp)$'));

-- Bucket ---------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('coach-media', 'coach-media', TRUE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
    SET public = TRUE,
        file_size_limit = 5242880,
        allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "coach_media_select_own" ON storage.objects;
CREATE POLICY "coach_media_select_own" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'coach-media' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "coach_media_insert_own" ON storage.objects;
CREATE POLICY "coach_media_insert_own" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'coach-media' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "coach_media_update_own" ON storage.objects;
CREATE POLICY "coach_media_update_own" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'coach-media' AND auth.uid()::text = (storage.foldername(name))[1])
    WITH CHECK (bucket_id = 'coach-media' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "coach_media_delete_own" ON storage.objects;
CREATE POLICY "coach_media_delete_own" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'coach-media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Public card JSON (adds logo_url / banner_url) ---------------------------------------------
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
                                                'interval', k.billing_interval, 'amount_cents', k.amount_cents, 'currency', k.currency)
                             ORDER BY k.position, k.created_at)
            FROM public.coach_packages k WHERE k.coach_id = c.coach_id AND k.is_active), '[]'::JSONB)
    )
    FROM public.coach_cards c JOIN public.profiles p ON p.id = c.coach_id
    WHERE c.coach_id = p_coach
$$;
REVOKE ALL ON FUNCTION public.coach_card_json(UUID) FROM PUBLIC, anon, authenticated;

-- Directory (adds logo_url / banner_url) -------------------------------------------------------
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
                   c.logo_url, c.banner_url,
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

-- The coach's own card (adds logo_url / banner_url) -----------------------------------------
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
                                                'currency', k.currency, 'is_active', k.is_active)
                             ORDER BY k.position, k.created_at)
            FROM public.coach_packages k WHERE k.coach_id = v_card.coach_id), '[]'::JSONB));
END;
$$;

-- save_coach_card (adds logo_url / banner_url; see 20270152000000_coach_cards.sql for the rest) ----
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
