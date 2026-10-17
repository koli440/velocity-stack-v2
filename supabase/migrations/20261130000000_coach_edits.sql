-- VelocityStack: coach WRITE access to physiology / training settings, audit trail, "set by
-- coach" labels, notification and coach dashboard data (coaching step 3).
--
-- Consent is wide (see docs/coaching.md): the ACTIVE coach of a rider (is_coach_of) may write
-- exactly these things and nothing else:
--   * ftp_history, weight_history, lactate_threshold_history, power_zone_history (RLS policies)
--   * the training defaults on profiles (home_track_id, default_chainring, default_cog,
--     crank_length_mm) through coach_update_athlete_profile() only; there is NO coach UPDATE
--     policy on profiles.
-- Activities, connections, secrets, templates, PBs, privacy zone, follows ... stay owner-only.
--
-- Every row a coach touches is stamped server-side (changed_by / changed_at / set_by_coach,
-- overwritten by a trigger so a client can never forge it; a later edit by the rider clears
-- the label) and recorded in the coach_edits audit table the rider can read. The rider gets ONE
-- unread 'coach_edited' notification per coach (further edits only bump it).

-- 1. Stamp columns on the history tables ---------------------------------------------------
ALTER TABLE public.ftp_history
    ADD COLUMN IF NOT EXISTS changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS set_by_coach BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.weight_history
    ADD COLUMN IF NOT EXISTS changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS set_by_coach BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.lactate_threshold_history
    ADD COLUMN IF NOT EXISTS changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS set_by_coach BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.power_zone_history
    ADD COLUMN IF NOT EXISTS changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS set_by_coach BOOLEAN NOT NULL DEFAULT FALSE;

-- Training defaults on the profile: who set them last (coach label).
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS training_set_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS training_set_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS training_set_by_coach BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Audit table and notification type -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coach_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    coach_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    table_name TEXT NOT NULL,
    row_id UUID,
    action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coach_edits_rider ON public.coach_edits (rider_id, created_at DESC);

ALTER TABLE public.coach_edits ENABLE ROW LEVEL SECURITY;

-- The rider sees everything done to their data; a coach only their own edits, and only while
-- they still coach the rider. Nobody writes this table directly (triggers do).
DROP POLICY IF EXISTS "coach_edits_select_rider" ON public.coach_edits;
CREATE POLICY "coach_edits_select_rider" ON public.coach_edits
    FOR SELECT TO authenticated USING (rider_id = auth.uid());
DROP POLICY IF EXISTS "coach_edits_select_coach" ON public.coach_edits;
CREATE POLICY "coach_edits_select_coach" ON public.coach_edits
    FOR SELECT TO authenticated USING (coach_id = auth.uid() AND public.is_coach_of(rider_id));

REVOKE ALL ON public.coach_edits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.coach_edits TO authenticated;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'new_follower', 'follow_request', 'follow_approved',
        'suggestion_submitted', 'suggestion_approved', 'suggestion_rejected',
        'coach_invite', 'coach_request', 'coach_accepted', 'coach_ended', 'coach_replaced',
        'coach_edited'
    ));

-- At most one UNREAD coach_edited notification per rider/coach: later edits bump it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_coach_edited_unread
    ON public.notifications (user_id, actor_id)
    WHERE type = 'coach_edited' AND read_at IS NULL;

-- 3. Stamping and auditing -----------------------------------------------------------------
-- BEFORE INSERT/UPDATE on the history tables: the stamp is always computed here. Signed-in
-- writes are stamped with the caller; service-side writes (no JWT) keep the existing stamp.
-- A row can never be moved to another rider.
CREATE OR REPLACE FUNCTION public.stamp_history_row()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'A history entry cannot be moved to another rider';
    END IF;
    IF auth.uid() IS NULL THEN
        IF TG_OP = 'UPDATE' THEN
            NEW.changed_by := OLD.changed_by;
            NEW.changed_at := OLD.changed_at;
            NEW.set_by_coach := OLD.set_by_coach;
        ELSE
            NEW.changed_by := NULL;
            NEW.changed_at := NULL;
            NEW.set_by_coach := FALSE;
        END IF;
    ELSE
        NEW.changed_by := auth.uid();
        NEW.changed_at := NOW();
        NEW.set_by_coach := auth.uid() <> NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;

-- Records a coach edit and notifies the rider (deduplicated).
CREATE OR REPLACE FUNCTION public.record_coach_edit(
    p_rider UUID, p_table TEXT, p_row UUID, p_action TEXT, p_old JSONB, p_new JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.coach_edits (rider_id, coach_id, table_name, row_id, action, old_values, new_values)
        VALUES (p_rider, auth.uid(), p_table, p_row, p_action, p_old, p_new);
    INSERT INTO public.notifications (user_id, actor_id, type)
        VALUES (p_rider, auth.uid(), 'coach_edited')
        ON CONFLICT (user_id, actor_id) WHERE type = 'coach_edited' AND read_at IS NULL
        DO UPDATE SET created_at = NOW();
END;
$$;
REVOKE ALL ON FUNCTION public.record_coach_edit(UUID, TEXT, UUID, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;

-- AFTER INSERT/UPDATE/DELETE on the history tables.
CREATE OR REPLACE FUNCTION public.audit_history_row()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    rider UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
BEGIN
    IF auth.uid() IS NOT NULL AND auth.uid() <> rider AND public.is_coach_of(rider) THEN
        PERFORM public.record_coach_edit(
            rider, TG_TABLE_NAME,
            CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
            lower(TG_OP),
            CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
        );
    END IF;
    RETURN NULL;
END;
$$;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['ftp_history', 'weight_history', 'lactate_threshold_history', 'power_zone_history'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_stamp ON public.%I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_stamp BEFORE INSERT OR UPDATE ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.stamp_history_row()', t, t);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_audit ON public.%I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.audit_history_row()', t, t);
    END LOOP;
END $$;

-- 4. Coach write policies (history tables) -------------------------------------------------
-- Permissive policies are OR-ed with the existing *_own ones. Both USING and WITH CHECK
-- require an active coaching relationship with the row's rider.
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN SELECT * FROM (VALUES
        ('ftp_history', 'ftp_history'),
        ('weight_history', 'weight_history'),
        ('lactate_threshold_history', 'lt_history'),
        ('power_zone_history', 'pz_history')
    ) AS v(tbl, prefix) LOOP
        EXECUTE format('DROP POLICY IF EXISTS "%s_insert_coach" ON public.%I', pol.prefix, pol.tbl);
        EXECUTE format('CREATE POLICY "%s_insert_coach" ON public.%I FOR INSERT TO authenticated
                        WITH CHECK (public.is_coach_of(user_id))', pol.prefix, pol.tbl);
        EXECUTE format('DROP POLICY IF EXISTS "%s_update_coach" ON public.%I', pol.prefix, pol.tbl);
        EXECUTE format('CREATE POLICY "%s_update_coach" ON public.%I FOR UPDATE TO authenticated
                        USING (public.is_coach_of(user_id)) WITH CHECK (public.is_coach_of(user_id))',
                       pol.prefix, pol.tbl);
        EXECUTE format('DROP POLICY IF EXISTS "%s_delete_coach" ON public.%I', pol.prefix, pol.tbl);
        EXECUTE format('CREATE POLICY "%s_delete_coach" ON public.%I FOR DELETE TO authenticated
                        USING (public.is_coach_of(user_id))', pol.prefix, pol.tbl);
    END LOOP;
END $$;

-- 5. Profile training defaults -------------------------------------------------------------
-- Keeps the "set by" label honest: it only changes together with a training column, is set
-- by the writer, and can never be written directly by a client.
CREATE OR REPLACE FUNCTION public.stamp_profile_training()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.training_set_by := NULL;
        NEW.training_set_at := NULL;
        NEW.training_set_by_coach := FALSE;
    ELSIF (NEW.home_track_id, NEW.default_chainring, NEW.default_cog, NEW.crank_length_mm)
          IS DISTINCT FROM (OLD.home_track_id, OLD.default_chainring, OLD.default_cog, OLD.crank_length_mm)
          AND auth.uid() IS NOT NULL THEN
        NEW.training_set_by := auth.uid();
        NEW.training_set_at := NOW();
        NEW.training_set_by_coach := auth.uid() <> NEW.id;
    ELSE
        NEW.training_set_by := OLD.training_set_by;
        NEW.training_set_at := OLD.training_set_at;
        NEW.training_set_by_coach := OLD.training_set_by_coach;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_training_stamp ON public.profiles;
CREATE TRIGGER trg_profiles_training_stamp
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.stamp_profile_training();

-- The only coach write path to profiles. p_changes is a JSON object limited to the keys
-- home_track_id, default_chainring, default_cog, crank_length_mm.
CREATE OR REPLACE FUNCTION public.coach_update_athlete_profile(p_rider UUID, p_changes JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    k TEXT;
    old_row JSONB;
    new_row JSONB;
    v_home UUID;
    v_ring INTEGER;
    v_cog INTEGER;
    v_crank NUMERIC;
BEGIN
    IF auth.uid() IS NULL OR p_rider IS NULL OR p_rider = auth.uid() OR NOT public.is_coach_of(p_rider) THEN
        RAISE EXCEPTION 'You do not coach this rider';
    END IF;
    IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
        RAISE EXCEPTION 'No changes given';
    END IF;
    FOR k IN SELECT jsonb_object_keys(p_changes) LOOP
        IF k NOT IN ('home_track_id', 'default_chainring', 'default_cog', 'crank_length_mm') THEN
            RAISE EXCEPTION 'Field % cannot be changed by a coach', k;
        END IF;
    END LOOP;

    SELECT jsonb_build_object('home_track_id', p.home_track_id, 'default_chainring', p.default_chainring,
                              'default_cog', p.default_cog, 'crank_length_mm', p.crank_length_mm)
      INTO old_row FROM public.profiles p WHERE p.id = p_rider FOR UPDATE;
    IF old_row IS NULL THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;

    v_home := CASE WHEN p_changes ? 'home_track_id' THEN NULLIF(p_changes ->> 'home_track_id', '')::UUID
                   ELSE (old_row ->> 'home_track_id')::UUID END;
    v_ring := CASE WHEN p_changes ? 'default_chainring' THEN NULLIF(p_changes ->> 'default_chainring', '')::INTEGER
                   ELSE (old_row ->> 'default_chainring')::INTEGER END;
    v_cog := CASE WHEN p_changes ? 'default_cog' THEN NULLIF(p_changes ->> 'default_cog', '')::INTEGER
                  ELSE (old_row ->> 'default_cog')::INTEGER END;
    v_crank := CASE WHEN p_changes ? 'crank_length_mm' THEN NULLIF(p_changes ->> 'crank_length_mm', '')::NUMERIC
                    ELSE (old_row ->> 'crank_length_mm')::NUMERIC END;

    IF v_ring IS NOT NULL AND v_ring NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid chainring'; END IF;
    IF v_cog IS NOT NULL AND v_cog NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid cog'; END IF;
    IF v_crank IS NOT NULL AND v_crank NOT BETWEEN 80 AND 250 THEN RAISE EXCEPTION 'Invalid crank length'; END IF;

    UPDATE public.profiles
       SET home_track_id = v_home, default_chainring = v_ring, default_cog = v_cog, crank_length_mm = v_crank
     WHERE id = p_rider;

    new_row := jsonb_build_object('home_track_id', v_home, 'default_chainring', v_ring,
                                  'default_cog', v_cog, 'crank_length_mm', v_crank);
    IF new_row IS DISTINCT FROM old_row THEN
        PERFORM public.record_coach_edit(p_rider, 'profiles', p_rider, 'update', old_row, new_row);
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.coach_update_athlete_profile(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_update_athlete_profile(UUID, JSONB) TO authenticated;

-- 6. Read helpers --------------------------------------------------------------------------
-- Training defaults incl. their "set by" label, for the coach (privacy zone etc. excluded).
DROP FUNCTION IF EXISTS public.get_athlete_profile(UUID);
CREATE FUNCTION public.get_athlete_profile(p_rider UUID)
RETURNS TABLE (
    id UUID,
    display_name TEXT,
    ftp_w INTEGER,
    home_track_id UUID,
    default_chainring INTEGER,
    default_cog INTEGER,
    crank_length_mm NUMERIC,
    training_set_by UUID,
    training_set_at TIMESTAMPTZ,
    training_set_by_coach BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.id,
           public.profile_display_name(p.nickname, p.first_name, p.last_name),
           p.ftp_w, p.home_track_id, p.default_chainring, p.default_cog, p.crank_length_mm,
           p.training_set_by, p.training_set_at, p.training_set_by_coach
    FROM public.profiles p
    WHERE p.id = p_rider AND public.is_coach_of(p_rider)
$$;
REVOKE ALL ON FUNCTION public.get_athlete_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_athlete_profile(UUID) TO authenticated;

-- Coach dashboard: one row per active athlete with last activity and the last 7 days.
CREATE OR REPLACE FUNCTION public.coach_dashboard()
RETURNS TABLE (
    rider_id UUID,
    since TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    week_count INTEGER,
    week_moving_time_s BIGINT,
    week_distance_m NUMERIC,
    week_training_load NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT c.rider_id,
           COALESCE(c.responded_at, c.created_at),
           (SELECT MAX(a.activity_date) FROM public.activities a WHERE a.user_id = c.rider_id),
           (SELECT COUNT(*)::INTEGER FROM public.activities a
             WHERE a.user_id = c.rider_id AND a.activity_date >= NOW() - INTERVAL '7 days'),
           (SELECT COALESCE(SUM(a.moving_time_s), 0)::BIGINT FROM public.activities a
             WHERE a.user_id = c.rider_id AND a.activity_date >= NOW() - INTERVAL '7 days'),
           (SELECT COALESCE(SUM(a.distance_m), 0) FROM public.activities a
             WHERE a.user_id = c.rider_id AND a.activity_date >= NOW() - INTERVAL '7 days'),
           (SELECT COALESCE(SUM(a.training_load), 0) FROM public.activities a
             WHERE a.user_id = c.rider_id AND a.activity_date >= NOW() - INTERVAL '7 days')
    FROM public.coaching_relationships c
    WHERE c.coach_id = auth.uid()
      AND c.status = 'active'
      AND public.is_coach_of(c.rider_id)
    ORDER BY 3 DESC NULLS LAST
$$;
REVOKE ALL ON FUNCTION public.coach_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_dashboard() TO authenticated;
