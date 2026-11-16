-- VelocityStack coach module, piece 3: coaching licence verification (behind the `coach_module` flag).
--
--  * licence_bodies: admin-maintained list of issuing bodies and levels (seeded with a sensible default,
--    editable by admins in SQL/Studio; see docs/coaching.md). A coach picks a body + level from it.
--  * coach_licences: one licence per coach. Status unverified (self-declared) / pending (evidence submitted) /
--    verified / rejected / expired / revoked. Only admin_review_licence() and the expiry job can set
--    verified/rejected/expired/revoked; a trigger resets verified -> pending/unverified whenever the licence
--    details change. Clients have no table privileges.
--  * Evidence goes to the private `licence-evidence` bucket (<coach_id>/<file>, 5 MB, PDF/JPEG/PNG/WebP);
--    readable only by the owner and admins.
--  * The public card shows a grey "self-declared" chip or a green "Verified" chip; expired/revoked/rejected show nothing.
--  * Daily pg_cron job (SQL only): notifies 30 days before and on expiry, expires verified licences, clears
--    evidence references 90 days after rejection.
-- All objects are additive and idempotent.

CREATE TABLE IF NOT EXISTS public.licence_bodies (
    id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
    name TEXT NOT NULL,
    levels TEXT[] NOT NULL DEFAULT '{}',
    position INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO public.licence_bodies (id, name, levels, position) VALUES
    ('uci', 'UCI', ARRAY['Level 1', 'Level 2', 'Level 3'], 10),
    ('british-cycling', 'British Cycling', ARRAY['Level 1', 'Level 2', 'Level 3', 'Level 4'], 20),
    ('usa-cycling', 'USA Cycling', ARRAY['Level 3', 'Level 2', 'Level 1'], 30),
    ('cycling-australia', 'Cycling Australia', ARRAY['Foundation', 'Intermediate', 'Advanced'], 40),
    ('cycling-canada', 'Cycling Canada', ARRAY['Community', 'Club', 'Provincial', 'National'], 50),
    ('national-federation', 'Other national federation', ARRAY['Basic', 'Intermediate', 'Advanced'], 90),
    ('other', 'Other qualification', ARRAY['Other'], 99)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.coach_licences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    body_id TEXT NOT NULL REFERENCES public.licence_bodies(id),
    level TEXT NOT NULL CHECK (char_length(level) BETWEEN 1 AND 60),
    licence_number TEXT CHECK (licence_number IS NULL OR char_length(licence_number) <= 60),
    valid_until DATE,
    evidence_path TEXT CHECK (evidence_path IS NULL OR char_length(evidence_path) <= 300),
    status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'pending', 'verified', 'rejected', 'expired', 'revoked')),
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT CHECK (review_note IS NULL OR char_length(review_note) <= 500),
    expiring_notified_at TIMESTAMPTZ,
    expired_notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coach_licences_status ON public.coach_licences (status, created_at);

CREATE TABLE IF NOT EXISTS public.licence_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    licence_id UUID NOT NULL REFERENCES public.coach_licences(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.licence_bodies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licence_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.licence_bodies, public.coach_licences, public.licence_audit FROM PUBLIC, anon, authenticated;

-- Evidence bucket (private) -------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('licence-evidence', 'licence-evidence', FALSE, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
    SET public = FALSE, file_size_limit = 5242880,
        allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "licence_evidence_select" ON storage.objects;
CREATE POLICY "licence_evidence_select" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'licence-evidence' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));
DROP POLICY IF EXISTS "licence_evidence_insert" ON storage.objects;
CREATE POLICY "licence_evidence_insert" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'licence-evidence' AND (storage.foldername(name))[1] = auth.uid()::text AND public.my_coach_module_enabled());
DROP POLICY IF EXISTS "licence_evidence_update" ON storage.objects;
CREATE POLICY "licence_evidence_update" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'licence-evidence' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'licence-evidence' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "licence_evidence_delete" ON storage.objects;
CREATE POLICY "licence_evidence_delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'licence-evidence' AND (storage.foldername(name))[1] = auth.uid()::text);

-- A change to what was verified sends the licence back to review (or to self-declared without evidence).
CREATE OR REPLACE FUNCTION public.coach_licences_reset_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.body_id, NEW.level, NEW.licence_number, NEW.valid_until, NEW.evidence_path)
        IS DISTINCT FROM (OLD.body_id, OLD.level, OLD.licence_number, OLD.valid_until, OLD.evidence_path) THEN
        NEW.status := CASE WHEN NEW.evidence_path IS NULL THEN 'unverified' ELSE 'pending' END;
        NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_note := NULL;
        NEW.expiring_notified_at := NULL; NEW.expired_notified_at := NULL;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_coach_licences_reset ON public.coach_licences;
CREATE TRIGGER trg_coach_licences_reset BEFORE UPDATE ON public.coach_licences
    FOR EACH ROW EXECUTE FUNCTION public.coach_licences_reset_on_change();

CREATE OR REPLACE FUNCTION public.licence_bodies_list()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'levels', to_jsonb(levels)) ORDER BY position, name), '[]'::JSONB)
    FROM public.licence_bodies WHERE is_active
$$;

CREATE OR REPLACE FUNCTION public.my_licence()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.coach_module_require();
    RETURN (SELECT jsonb_build_object('body_id', l.body_id, 'body', b.name, 'level', l.level, 'licence_number', l.licence_number,
                                      'valid_until', l.valid_until, 'evidence_path', l.evidence_path, 'status', l.status,
                                      'review_note', l.review_note, 'reviewed_at', l.reviewed_at)
            FROM public.coach_licences l JOIN public.licence_bodies b ON b.id = l.body_id WHERE l.coach_id = auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.save_my_licence(p_body TEXT, p_level TEXT, p_number TEXT DEFAULT NULL,
                                                  p_valid_until DATE DEFAULT NULL, p_evidence_path TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_level TEXT := btrim(COALESCE(p_level, ''));
    v_number TEXT := NULLIF(btrim(COALESCE(p_number, '')), '');
    v_path TEXT := NULLIF(btrim(COALESCE(p_evidence_path, '')), '');
    b public.licence_bodies;
    v_status TEXT;
BEGIN
    PERFORM public.coach_module_require();
    SELECT * INTO b FROM public.licence_bodies WHERE id = p_body AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown licence body'; END IF;
    IF NOT (v_level = ANY (b.levels)) THEN RAISE EXCEPTION 'Unknown licence level'; END IF;
    IF v_number IS NOT NULL AND char_length(v_number) > 60 THEN RAISE EXCEPTION 'Licence number is too long'; END IF;
    IF p_valid_until IS NOT NULL AND p_valid_until < CURRENT_DATE - 1 THEN RAISE EXCEPTION 'Licence is already expired'; END IF;
    IF v_path IS NOT NULL AND (left(v_path, 37) <> v_me::TEXT || '/' OR v_path ~ '\.\.' OR char_length(v_path) > 300) THEN
        RAISE EXCEPTION 'Invalid evidence file';
    END IF;
    INSERT INTO public.coach_licences (coach_id, body_id, level, licence_number, valid_until, evidence_path, status)
        VALUES (v_me, b.id, v_level, v_number, p_valid_until, v_path, CASE WHEN v_path IS NULL THEN 'unverified' ELSE 'pending' END)
        ON CONFLICT (coach_id) DO UPDATE
        SET body_id = EXCLUDED.body_id, level = EXCLUDED.level, licence_number = EXCLUDED.licence_number,
            valid_until = EXCLUDED.valid_until, evidence_path = EXCLUDED.evidence_path;
    SELECT status INTO v_status FROM public.coach_licences WHERE coach_id = v_me;
    INSERT INTO public.licence_audit (licence_id, actor_id, action)
        SELECT id, v_me, 'saved' FROM public.coach_licences WHERE coach_id = v_me;
    RETURN v_status;
END $$;

-- Withdrawing is a privacy right: works with the flag off.
CREATE OR REPLACE FUNCTION public.delete_my_licence()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    DELETE FROM public.coach_licences WHERE coach_id = auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.admin_licence_queue()
RETURNS TABLE (id UUID, coach_name TEXT, coach_slug TEXT, body TEXT, level TEXT, licence_number TEXT, valid_until DATE,
               evidence_path TEXT, status TEXT, review_note TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
    RETURN QUERY
        SELECT l.id, public.profile_display_name(p.nickname, p.first_name, p.last_name), c.slug, b.name, l.level, l.licence_number,
               l.valid_until, l.evidence_path, l.status, l.review_note, l.created_at, l.updated_at
        FROM public.coach_licences l
        JOIN public.profiles p ON p.id = l.coach_id
        JOIN public.licence_bodies b ON b.id = l.body_id
        LEFT JOIN public.coach_cards c ON c.coach_id = l.coach_id
        WHERE l.status <> 'unverified'
        ORDER BY (l.status = 'pending') DESC, l.updated_at ASC LIMIT 300;
END $$;

CREATE OR REPLACE FUNCTION public.admin_licence_counts()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
    RETURN jsonb_build_object('pending', (SELECT count(*) FROM public.coach_licences WHERE status = 'pending'),
                              'verified', (SELECT count(*) FROM public.coach_licences WHERE status = 'verified'),
                              'expired', (SELECT count(*) FROM public.coach_licences WHERE status = 'expired'));
END $$;

-- decision: 'verify' (pending -> verified), 'reject' (pending -> rejected), 'revoke' (verified -> revoked).
CREATE OR REPLACE FUNCTION public.admin_review_licence(p_id UUID, p_decision TEXT, p_note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    l public.coach_licences;
    v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
    v_new TEXT;
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
    IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN RAISE EXCEPTION 'Note is too long'; END IF;
    SELECT * INTO l FROM public.coach_licences WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Licence not found'; END IF;
    IF p_decision = 'verify' AND l.status = 'pending' THEN
        IF l.valid_until IS NOT NULL AND l.valid_until < CURRENT_DATE THEN RAISE EXCEPTION 'Licence is expired'; END IF;
        v_new := 'verified';
    ELSIF p_decision = 'reject' AND l.status = 'pending' THEN v_new := 'rejected';
    ELSIF p_decision = 'revoke' AND l.status = 'verified' THEN v_new := 'revoked';
    ELSE RAISE EXCEPTION 'Invalid decision for status %', l.status;
    END IF;
    IF v_new <> 'verified' AND v_note IS NULL THEN RAISE EXCEPTION 'A note is required'; END IF;
    UPDATE public.coach_licences SET status = v_new, reviewed_by = auth.uid(), reviewed_at = NOW(), review_note = v_note WHERE id = p_id;
    INSERT INTO public.licence_audit (licence_id, actor_id, action, note) VALUES (p_id, auth.uid(), p_decision, v_note);
    INSERT INTO public.notifications (user_id, actor_id, type) VALUES (l.coach_id, NULL, 'licence_reviewed');
END $$;

-- Licence as shown on the public card: only self-declared or verified.
CREATE OR REPLACE FUNCTION public.coach_licence_public(p_coach UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object('verified', l.status = 'verified', 'body', b.name, 'level', l.level)
    FROM public.coach_licences l JOIN public.licence_bodies b ON b.id = l.body_id
    WHERE l.coach_id = p_coach AND l.status IN ('unverified', 'pending', 'verified')
$$;
REVOKE ALL ON FUNCTION public.coach_licence_public(UUID) FROM PUBLIC, anon, authenticated;

-- Card JSON gains a `licence` key (null when none/expired/revoked/rejected).
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

-- Daily job: expiry notices, expiry, and evidence clean-up after rejection. SQL only, no secrets.
CREATE OR REPLACE FUNCTION public.coach_licence_expiry_run()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r RECORD;
    v_n INTEGER := 0;
BEGIN
    FOR r IN SELECT id, coach_id FROM public.coach_licences
             WHERE status = 'verified' AND valid_until IS NOT NULL AND valid_until < CURRENT_DATE LOOP
        UPDATE public.coach_licences SET status = 'expired', expired_notified_at = NOW() WHERE id = r.id;
        INSERT INTO public.licence_audit (licence_id, action) VALUES (r.id, 'expired');
        INSERT INTO public.notifications (user_id, actor_id, type) VALUES (r.coach_id, NULL, 'licence_expiring');
        v_n := v_n + 1;
    END LOOP;
    FOR r IN SELECT id, coach_id FROM public.coach_licences
             WHERE status IN ('verified', 'pending') AND valid_until IS NOT NULL
               AND valid_until >= CURRENT_DATE AND valid_until <= CURRENT_DATE + 30 AND expiring_notified_at IS NULL LOOP
        UPDATE public.coach_licences SET expiring_notified_at = NOW() WHERE id = r.id;
        INSERT INTO public.notifications (user_id, actor_id, type) VALUES (r.coach_id, NULL, 'licence_expiring');
        v_n := v_n + 1;
    END LOOP;
    -- Evidence of rejected licences is dropped 90 days later (the stored file itself is removed by the owner / a storage clean-up).
    UPDATE public.coach_licences SET evidence_path = NULL
        WHERE status = 'rejected' AND evidence_path IS NOT NULL AND reviewed_at < NOW() - INTERVAL '90 days';
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.coach_licence_expiry_run() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'coach-licence-expiry') THEN
        PERFORM cron.unschedule('coach-licence-expiry');
    END IF;
    PERFORM cron.schedule('coach-licence-expiry', '20 4 * * *', 'SELECT public.coach_licence_expiry_run()');
END $$;

DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'licence_bodies_list()', 'my_licence()', 'save_my_licence(text, text, text, date, text)', 'delete_my_licence()',
        'admin_licence_queue()', 'admin_licence_counts()', 'admin_review_licence(uuid, text, text)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
