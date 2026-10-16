-- VelocityStack: admin role + generic suggestion/moderation flow (issue #176, epic #179)
--
-- * profiles.is_admin + public.is_admin(): server-side admin check usable from RLS/RPCs.
--   Only the service role / SQL editor can change the flag (promote with
--   `UPDATE public.profiles SET is_admin = TRUE WHERE id = '<user uuid>'`).
-- * suggestion_targets: registry of entities that may be suggested (velodromes, disciplines, ...).
--   Later features register themselves with an INSERT in their own migration.
-- * suggestions: pending/approved/rejected proposals. Users can only insert and read their own;
--   admins read all and decide through review_suggestion(), which applies the change
--   to the target table in the same transaction.
-- * In-app notifications: admins are notified of each new suggestion (link: /admin/suggestions/<id>),
--   the submitter is notified of the outcome. No external secrets are required.
-- * Rate limiting: max 5 submissions per hour and 20 pending per user.

-- 1. Admin role ----------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.protect_admin_flag()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE(auth.role(), 'service_role') = 'service_role' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.is_admin := FALSE;
    ELSE
        NEW.is_admin := OLD.is_admin;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_admin_flag ON public.profiles;
CREATE TRIGGER trg_protect_admin_flag
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.protect_admin_flag();

CREATE OR REPLACE FUNCTION public.is_admin(p_user UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = p_user), FALSE)
$$;

REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;

-- 2. Registry of suggestable entities ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suggestion_targets (
    entity_type TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    id_column TEXT NOT NULL DEFAULT 'id',
    label TEXT NOT NULL,
    -- Only these payload keys are accepted and applied; everything else is rejected.
    allowed_columns TEXT[] NOT NULL CHECK (cardinality(allowed_columns) > 0)
);

ALTER TABLE public.suggestion_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suggestion_targets_select" ON public.suggestion_targets;
CREATE POLICY "suggestion_targets_select"
    ON public.suggestion_targets FOR SELECT
    USING (auth.role() = 'authenticated');

REVOKE ALL ON public.suggestion_targets FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.suggestion_targets FROM authenticated;
GRANT SELECT ON public.suggestion_targets TO authenticated;

-- 3. Suggestions ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL REFERENCES public.suggestion_targets(entity_type),
    target_id TEXT,                       -- NULL = proposal for a new row
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    submitter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON public.suggestions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestions_submitter ON public.suggestions(submitter_id, created_at DESC);

ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suggestions_select_own_or_admin" ON public.suggestions;
CREATE POLICY "suggestions_select_own_or_admin"
    ON public.suggestions FOR SELECT
    USING (auth.uid() = submitter_id OR public.is_admin());

DROP POLICY IF EXISTS "suggestions_insert_own" ON public.suggestions;
CREATE POLICY "suggestions_insert_own"
    ON public.suggestions FOR INSERT
    WITH CHECK (auth.uid() = submitter_id AND status = 'pending');

REVOKE ALL ON public.suggestions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.suggestions FROM authenticated;
GRANT SELECT ON public.suggestions TO authenticated;
GRANT INSERT (entity_type, target_id, payload, submitter_id) ON public.suggestions TO authenticated;

-- Validation + rate limiting on submit.
CREATE OR REPLACE FUNCTION public.validate_suggestion()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_allowed TEXT[];
    v_bad TEXT;
BEGIN
    SELECT allowed_columns INTO v_allowed FROM public.suggestion_targets WHERE entity_type = NEW.entity_type;
    IF v_allowed IS NULL THEN
        RAISE EXCEPTION 'Unknown suggestion type %', NEW.entity_type;
    END IF;

    SELECT k INTO v_bad FROM jsonb_object_keys(NEW.payload) AS k WHERE k <> ALL (v_allowed) LIMIT 1;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Field "%" cannot be suggested', v_bad;
    END IF;
    IF NEW.payload = '{}'::jsonb THEN
        RAISE EXCEPTION 'Suggestion is empty';
    END IF;

    IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
        IF (SELECT COUNT(*) FROM public.suggestions
            WHERE submitter_id = NEW.submitter_id AND created_at > NOW() - INTERVAL '1 hour') >= 5 THEN
            RAISE EXCEPTION 'Too many suggestions, please try again later';
        END IF;
        IF (SELECT COUNT(*) FROM public.suggestions
            WHERE submitter_id = NEW.submitter_id AND status = 'pending') >= 20 THEN
            RAISE EXCEPTION 'Too many pending suggestions';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_suggestion ON public.suggestions;
CREATE TRIGGER trg_validate_suggestion
    BEFORE INSERT ON public.suggestions
    FOR EACH ROW EXECUTE FUNCTION public.validate_suggestion();

-- 4. Notifications (extend the existing table) ---------------------------------------
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS suggestion_id UUID REFERENCES public.suggestions(id) ON DELETE CASCADE;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'new_follower', 'follow_request', 'follow_approved',
        'suggestion_submitted', 'suggestion_approved', 'suggestion_rejected'
    ));

CREATE OR REPLACE FUNCTION public.notify_admins_of_suggestion()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.notifications (user_id, actor_id, type, suggestion_id)
    SELECT p.id, NEW.submitter_id, 'suggestion_submitted', NEW.id
    FROM public.profiles p
    WHERE p.is_admin AND p.id <> NEW.submitter_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admins_of_suggestion ON public.suggestions;
CREATE TRIGGER trg_notify_admins_of_suggestion
    AFTER INSERT ON public.suggestions
    FOR EACH ROW EXECUTE FUNCTION public.notify_admins_of_suggestion();

-- 5. Review: approve applies the change transactionally ------------------------------
CREATE OR REPLACE FUNCTION public.review_suggestion(p_id UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS public.suggestions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    s public.suggestions;
    t public.suggestion_targets;
    v_cols TEXT;
    v_count INTEGER;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Admin only';
    END IF;

    SELECT * INTO s FROM public.suggestions WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Suggestion not found';
    END IF;
    IF s.status <> 'pending' THEN
        RAISE EXCEPTION 'Suggestion already reviewed';
    END IF;

    IF p_approve THEN
        SELECT * INTO t FROM public.suggestion_targets WHERE entity_type = s.entity_type;

        IF s.target_id IS NULL THEN
            SELECT string_agg(format('%I', k), ', ') INTO v_cols FROM jsonb_object_keys(s.payload) AS k;
            EXECUTE format(
                'INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1)',
                t.table_name, v_cols
            ) USING s.payload;
        ELSE
            SELECT string_agg(format('%1$I = r.%1$I', k), ', ') INTO v_cols FROM jsonb_object_keys(s.payload) AS k;
            EXECUTE format(
                'UPDATE public.%1$I SET %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1) AS r WHERE %3$I::text = $2',
                t.table_name, v_cols, t.id_column
            ) USING s.payload, s.target_id;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            IF v_count = 0 THEN
                RAISE EXCEPTION 'Target % not found', s.target_id;
            END IF;
        END IF;
    END IF;

    UPDATE public.suggestions
        SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
            reviewed_by = auth.uid(),
            reviewed_at = NOW(),
            review_note = NULLIF(BTRIM(p_note), '')
        WHERE id = p_id
        RETURNING * INTO s;

    IF s.submitter_id <> auth.uid() THEN
        INSERT INTO public.notifications (user_id, actor_id, type, suggestion_id)
        VALUES (s.submitter_id, auth.uid(),
                CASE WHEN p_approve THEN 'suggestion_approved' ELSE 'suggestion_rejected' END, s.id);
    END IF;
    RETURN s;
END;
$$;

REVOKE ALL ON FUNCTION public.review_suggestion(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_suggestion(UUID, BOOLEAN, TEXT) TO authenticated;
