-- VelocityStack: coaching relationships, consent and coach READ access (coaching step 2)
--
-- * coaching_relationships: coach <-> rider, either side may initiate, the other side must
--   accept. Accepting always means the rider consented (coach-initiated: the rider accepts;
--   rider-initiated: the request is the consent and the coach accepts).
-- * A rider has at most ONE active coach. Accepting a new coach's invite swaps atomically:
--   the previous coach loses access immediately and is notified.
-- * Writes only through SECURITY DEFINER functions; clients have no table privileges
--   (declined stays silent, so reading the table directly would leak the decision).
-- * is_coach_of(rider) drives READ policies. Coaches read activities through the masked
--   shared_activities view (privacy-zone coordinates never leave the database), never the
--   raw table. Secrets (connections, profile_secrets, e-mail) are never exposed.
-- * Blocks end every relationship between the two riders.

-- 1. Table ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coaching_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'declined', 'ended')),
    initiated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    ended_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    CHECK (coach_id <> rider_id),
    CHECK (initiated_by IN (coach_id, rider_id))
);

-- One active coach per rider; one pending request per coach/rider pair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_coaching_one_active_coach
    ON public.coaching_relationships (rider_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_coaching_one_pending_pair
    ON public.coaching_relationships (coach_id, rider_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_coaching_coach ON public.coaching_relationships (coach_id, status);
CREATE INDEX IF NOT EXISTS idx_coaching_rider ON public.coaching_relationships (rider_id, status);

ALTER TABLE public.coaching_relationships ENABLE ROW LEVEL SECURITY;

-- Participants may select (never declined rows: a decline is silent). Defence in depth only:
-- table privileges are revoked below, the app reads through my_coaching().
DROP POLICY IF EXISTS "coaching_select_participants" ON public.coaching_relationships;
CREATE POLICY "coaching_select_participants"
    ON public.coaching_relationships FOR SELECT
    USING ((auth.uid() = coach_id OR auth.uid() = rider_id) AND status <> 'declined');

REVOKE ALL ON public.coaching_relationships FROM PUBLIC, anon, authenticated;

-- 2. Notifications -------------------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'new_follower', 'follow_request', 'follow_approved',
        'suggestion_submitted', 'suggestion_approved', 'suggestion_rejected',
        'coach_invite', 'coach_request', 'coach_accepted', 'coach_ended', 'coach_replaced'
    ));

-- 3. Access helper -------------------------------------------------------------------------
-- True when the signed-in user is the rider's ACTIVE coach (and nobody blocked anybody).
CREATE OR REPLACE FUNCTION public.is_coach_of(p_rider UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT auth.uid() IS NOT NULL AND p_rider IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.coaching_relationships c
        WHERE c.coach_id = auth.uid()
          AND c.rider_id = p_rider
          AND c.status = 'active'
          AND NOT public.is_blocked_between(c.coach_id, c.rider_id)
    )
$$;

-- True when the signed-in user coaches the owner of the activity.
CREATE OR REPLACE FUNCTION public.is_coach_of_activity_owner(p_activity UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.activities a
        WHERE a.id = p_activity AND public.is_coach_of(a.user_id)
    )
$$;

REVOKE ALL ON FUNCTION public.is_coach_of(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_coach_of_activity_owner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_coach_of(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_coach_of_activity_owner(UUID) TO authenticated;

-- 4. Creating, answering and ending relationships ------------------------------------------
-- Shared creation logic (not callable by clients).
CREATE OR REPLACE FUNCTION public.create_coaching_request(p_coach UUID, p_rider UUID, p_initiator UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_other UUID := CASE WHEN p_initiator = p_coach THEN p_rider ELSE p_coach END;
    v_id UUID;
BEGIN
    IF p_initiator IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF p_coach IS NULL OR p_rider IS NULL OR p_coach = p_rider THEN
        RAISE EXCEPTION 'You cannot coach yourself';
    END IF;
    -- A block (either direction) looks exactly like a missing rider.
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_other AND NOT is_bot)
       OR public.is_blocked_between(p_coach, p_rider) THEN
        RAISE EXCEPTION 'Rider not found';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.coaching_relationships
        WHERE coach_id = p_coach AND rider_id = p_rider AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'You already have a coaching relationship with this rider';
    END IF;
    -- A declined request still counts as pending for 30 days so a decline stays silent and
    -- cannot be bypassed by re-sending.
    IF EXISTS (
        SELECT 1 FROM public.coaching_relationships
        WHERE coach_id = p_coach AND rider_id = p_rider
          AND (status = 'pending' OR (status = 'declined' AND responded_at > NOW() - INTERVAL '30 days'))
    ) THEN
        RAISE EXCEPTION 'A coaching request is already pending with this rider';
    END IF;
    IF (SELECT count(*) FROM public.coaching_relationships
        WHERE initiated_by = p_initiator AND status = 'pending') >= 25 THEN
        RAISE EXCEPTION 'Too many pending coaching requests';
    END IF;

    BEGIN
        INSERT INTO public.coaching_relationships (coach_id, rider_id, initiated_by)
            VALUES (p_coach, p_rider, p_initiator)
            RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'A coaching request is already pending with this rider';
    END;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_coaching_request(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Coach invites a rider ("Invite as athlete"); the rider must accept.
CREATE OR REPLACE FUNCTION public.invite_athlete(p_rider UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN public.create_coaching_request(auth.uid(), p_rider, auth.uid());
END;
$$;

-- Rider asks a rider to coach them ("Request as my coach"); the coach must accept.
-- A rider who already has a coach must end that relationship first, so a coach's later
-- acceptance can never replace the current coach behind the rider's back.
CREATE OR REPLACE FUNCTION public.request_coach(p_coach UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.coaching_relationships
        WHERE rider_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'End your current coaching relationship before requesting a new coach';
    END IF;
    RETURN public.create_coaching_request(p_coach, auth.uid(), auth.uid());
END;
$$;

-- Accept a request addressed to the caller. When the rider accepts a coach's invite, the
-- rider's current coach is replaced in the same transaction.
CREATE OR REPLACE FUNCTION public.accept_coaching(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_rider UUID;
    r public.coaching_relationships;
    v_old public.coaching_relationships;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    SELECT rider_id INTO v_rider FROM public.coaching_relationships WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such coaching request';
    END IF;
    -- Serialise per rider so concurrent accepts cannot both succeed.
    PERFORM pg_advisory_xact_lock(hashtext('coaching:' || v_rider::text));

    SELECT * INTO r FROM public.coaching_relationships WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR r.status <> 'pending' OR r.initiated_by = v_me
       OR v_me NOT IN (r.coach_id, r.rider_id) THEN
        RAISE EXCEPTION 'No such coaching request';
    END IF;
    IF public.is_blocked_between(r.coach_id, r.rider_id) THEN
        UPDATE public.coaching_relationships
            SET status = 'ended', ended_at = NOW(), ended_by = v_me WHERE id = r.id;
        RAISE EXCEPTION 'No such coaching request';
    END IF;

    SELECT * INTO v_old FROM public.coaching_relationships
        WHERE rider_id = r.rider_id AND status = 'active' FOR UPDATE;
    IF FOUND THEN
        -- The coach accepting a rider's request must not replace a coach the rider has
        -- since accepted; only the rider's own accept replaces.
        IF v_me <> r.rider_id THEN
            RAISE EXCEPTION 'This rider already has a coach';
        END IF;
        UPDATE public.coaching_relationships
            SET status = 'ended', ended_at = NOW(), ended_by = v_me WHERE id = v_old.id;
        INSERT INTO public.notifications (user_id, actor_id, type)
            VALUES (v_old.coach_id, v_me, 'coach_replaced');
    END IF;

    UPDATE public.coaching_relationships
        SET status = 'active', responded_at = NOW() WHERE id = r.id;
    INSERT INTO public.notifications (user_id, actor_id, type)
        VALUES (r.initiated_by, v_me, 'coach_accepted');
END;
$$;

-- Decline silently: no notification and the requester keeps seeing it as pending.
CREATE OR REPLACE FUNCTION public.decline_coaching(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    UPDATE public.coaching_relationships
        SET status = 'declined', responded_at = NOW()
        WHERE id = p_id AND status = 'pending' AND initiated_by <> v_me
          AND v_me IN (coach_id, rider_id);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such coaching request';
    END IF;
END;
$$;

-- Rider revokes access, coach leaves, or the requester cancels their own request.
CREATE OR REPLACE FUNCTION public.end_coaching(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    r public.coaching_relationships;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    SELECT * INTO r FROM public.coaching_relationships WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR v_me NOT IN (r.coach_id, r.rider_id) THEN
        RAISE EXCEPTION 'No such coaching relationship';
    END IF;

    IF r.status = 'active' THEN
        UPDATE public.coaching_relationships
            SET status = 'ended', ended_at = NOW(), ended_by = v_me WHERE id = r.id;
        INSERT INTO public.notifications (user_id, actor_id, type)
            VALUES (CASE WHEN v_me = r.coach_id THEN r.rider_id ELSE r.coach_id END, v_me, 'coach_ended');
    ELSIF r.status IN ('pending', 'declined') AND r.initiated_by = v_me THEN
        UPDATE public.coaching_relationships
            SET status = 'ended', ended_at = NOW(), ended_by = v_me WHERE id = r.id;
    ELSE
        RAISE EXCEPTION 'No such coaching relationship';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.invite_athlete(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_coach(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_coaching(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_coaching(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_coaching(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_athlete(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_coach(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_coaching(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_coaching(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_coaching(UUID) TO authenticated;

-- 5. Reading relationships -----------------------------------------------------------------
-- The caller's pending and active relationships. A declined request is shown as 'pending' to
-- the requester and hidden from the responder (declines are silent).
CREATE OR REPLACE FUNCTION public.my_coaching()
RETURNS TABLE (
    id UUID,
    coach_id UUID,
    rider_id UUID,
    status TEXT,
    initiated_by UUID,
    created_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT c.id, c.coach_id, c.rider_id,
           CASE WHEN c.status = 'declined' THEN 'pending' ELSE c.status END,
           c.initiated_by, c.created_at,
           CASE WHEN c.status = 'declined' THEN NULL ELSE c.responded_at END
    FROM public.coaching_relationships c
    WHERE auth.uid() IN (c.coach_id, c.rider_id)
      AND (c.status IN ('pending', 'active') OR (c.status = 'declined' AND c.initiated_by = auth.uid()))
      AND NOT public.is_blocked_between(c.coach_id, c.rider_id)
    ORDER BY c.created_at DESC
$$;

-- How the signed-in user relates to another rider, for the rider profile buttons.
-- status: none | coach (they coach me) | athlete (I coach them) | invited | requested |
--         invite_received | request_received. id is the relationship, when there is one.
CREATE OR REPLACE FUNCTION public.coaching_status_with(p_other UUID)
RETURNS TABLE (id UUID, status TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT c.id,
           CASE
               WHEN c.status = 'active' AND c.rider_id = auth.uid() THEN 'coach'
               WHEN c.status = 'active' THEN 'athlete'
               WHEN c.initiated_by = auth.uid() AND c.coach_id = auth.uid() THEN 'invited'
               WHEN c.initiated_by = auth.uid() THEN 'requested'
               WHEN c.coach_id = p_other THEN 'invite_received'
               ELSE 'request_received'
           END
    FROM public.coaching_relationships c
    WHERE auth.uid() IS NOT NULL
      AND ((c.coach_id = auth.uid() AND c.rider_id = p_other) OR (c.rider_id = auth.uid() AND c.coach_id = p_other))
      AND (c.status IN ('pending', 'active') OR (c.status = 'declined' AND c.initiated_by = auth.uid()))
      AND NOT public.is_blocked_between(auth.uid(), p_other)
    ORDER BY (c.status = 'active') DESC, c.created_at DESC
    LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.my_coaching() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coaching_status_with(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_coaching() TO authenticated;
GRANT EXECUTE ON FUNCTION public.coaching_status_with(UUID) TO authenticated;

-- Training-relevant profile fields of an athlete, for the coach. Deliberately excludes the
-- privacy zone, e-mail, secrets, connections and UI preferences.
CREATE OR REPLACE FUNCTION public.get_athlete_profile(p_rider UUID)
RETURNS TABLE (
    id UUID,
    display_name TEXT,
    ftp_w INTEGER,
    home_track_id UUID,
    default_chainring INTEGER,
    default_cog INTEGER,
    crank_length_mm NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.id,
           public.profile_display_name(p.nickname, p.first_name, p.last_name),
           p.ftp_w, p.home_track_id, p.default_chainring, p.default_cog, p.crank_length_mm
    FROM public.profiles p
    WHERE p.id = p_rider AND public.is_coach_of(p_rider)
$$;

REVOKE ALL ON FUNCTION public.get_athlete_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_athlete_profile(UUID) TO authenticated;

-- 6. Triggers ------------------------------------------------------------------------------
-- New request -> notify the other side.
CREATE OR REPLACE FUNCTION public.notify_coaching_request()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.status = 'pending' THEN
        INSERT INTO public.notifications (user_id, actor_id, type)
            VALUES (
                CASE WHEN NEW.initiated_by = NEW.coach_id THEN NEW.rider_id ELSE NEW.coach_id END,
                NEW.initiated_by,
                CASE WHEN NEW.initiated_by = NEW.coach_id THEN 'coach_invite' ELSE 'coach_request' END
            );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_coaching_request ON public.coaching_relationships;
CREATE TRIGGER trg_notify_coaching_request
    AFTER INSERT ON public.coaching_relationships
    FOR EACH ROW EXECUTE FUNCTION public.notify_coaching_request();

-- A resolved request no longer needs its notification.
CREATE OR REPLACE FUNCTION public.clear_coaching_request_notice()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    DELETE FROM public.notifications
        WHERE user_id = CASE WHEN OLD.initiated_by = OLD.coach_id THEN OLD.rider_id ELSE OLD.coach_id END
          AND actor_id = OLD.initiated_by
          AND type IN ('coach_invite', 'coach_request');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_coaching_request_notice ON public.coaching_relationships;
CREATE TRIGGER trg_clear_coaching_request_notice
    AFTER UPDATE OF status ON public.coaching_relationships
    FOR EACH ROW WHEN (OLD.status = 'pending' AND NEW.status <> 'pending')
    EXECUTE FUNCTION public.clear_coaching_request_notice();

-- A block ends every relationship between the two riders (silently).
CREATE OR REPLACE FUNCTION public.end_coaching_on_block()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.coaching_relationships
        SET status = 'ended', ended_at = NOW(), ended_by = NEW.blocker_id
        WHERE status IN ('pending', 'declined', 'active')
          AND ((coach_id = NEW.blocker_id AND rider_id = NEW.blocked_id)
            OR (coach_id = NEW.blocked_id AND rider_id = NEW.blocker_id));
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_end_coaching_on_block ON public.blocks;
CREATE TRIGGER trg_end_coaching_on_block
    AFTER INSERT ON public.blocks
    FOR EACH ROW EXECUTE FUNCTION public.end_coaching_on_block();

-- 7. Coach READ access ---------------------------------------------------------------------
-- 7a. Activities: the base table stays owner-only (raw GPS, raw file). The coach reads the
-- masked shared_activities view (no raw coordinates, route_preview only when built with the
-- rider's current privacy zone), which now also includes private activities of athletes.
DROP VIEW IF EXISTS public.shared_activities;
CREATE VIEW public.shared_activities AS
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
        END AS time_series
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

-- 7b. Photos (rows and signed URLs) follow can_view_activity(), which now includes the coach.
CREATE OR REPLACE FUNCTION public.can_view_activity(p_activity UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.activities a
        WHERE a.id = p_activity
          AND (
              a.user_id = auth.uid()
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
              )
          )
    )
$$;

-- 7c. Streams / curves. (time_series lives on activities and is only exposed, without
-- coordinates, by the view above. activity_curves holds power/HR/etc. curves, no GPS.)
DROP POLICY IF EXISTS "activity_curves_select_coach" ON public.activity_curves;
CREATE POLICY "activity_curves_select_coach" ON public.activity_curves FOR SELECT TO authenticated
    USING (public.is_coach_of_activity_owner(activity_id));

-- 7d. Rider-owned history and result tables: read-only for the coach.
DROP POLICY IF EXISTS "template_executions_select_coach" ON public.template_executions;
CREATE POLICY "template_executions_select_coach" ON public.template_executions FOR SELECT TO authenticated
    USING (public.is_coach_of(user_id));

DROP POLICY IF EXISTS "analysis_templates_select_coach" ON public.analysis_templates;
CREATE POLICY "analysis_templates_select_coach" ON public.analysis_templates FOR SELECT TO authenticated
    USING (user_id IS NOT NULL AND public.is_coach_of(user_id));

DROP POLICY IF EXISTS "personal_bests_select_coach" ON public.personal_bests;
CREATE POLICY "personal_bests_select_coach" ON public.personal_bests FOR SELECT TO authenticated
    USING (public.is_coach_of(user_id));

DROP POLICY IF EXISTS "aero_tests_select_coach" ON public.aero_tests;
CREATE POLICY "aero_tests_select_coach" ON public.aero_tests FOR SELECT TO authenticated
    USING (public.is_coach_of(user_id));

DROP POLICY IF EXISTS "ftp_history_select_coach" ON public.ftp_history;
CREATE POLICY "ftp_history_select_coach" ON public.ftp_history FOR SELECT TO authenticated
    USING (public.is_coach_of(user_id));

DROP POLICY IF EXISTS "weight_history_select_coach" ON public.weight_history;
CREATE POLICY "weight_history_select_coach" ON public.weight_history FOR SELECT TO authenticated
    USING (public.is_coach_of(user_id));

DROP POLICY IF EXISTS "lt_history_select_coach" ON public.lactate_threshold_history;
CREATE POLICY "lt_history_select_coach" ON public.lactate_threshold_history FOR SELECT TO authenticated
    USING (public.is_coach_of(user_id));

DROP POLICY IF EXISTS "pz_history_select_coach" ON public.power_zone_history;
CREATE POLICY "pz_history_select_coach" ON public.power_zone_history FOR SELECT TO authenticated
    USING (public.is_coach_of(user_id));

-- 7e. Baseline ("history") curves read activities + curves of the given rider. Runs as the
-- definer so a coach can compute them without reading the raw activities table; the
-- caller must be the rider or the rider's coach, otherwise the result is empty (as before).
CREATE OR REPLACE FUNCTION public.get_athlete_baseline_curves(
  p_user_id UUID,
  p_period TEXT,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ := COALESCE(p_end_date, NOW());
  v_curves JSONB;
BEGIN
  IF p_period = 'all_time' THEN
    v_start := '-infinity'::TIMESTAMPTZ;
  ELSIF p_period = '30d' THEN
    v_start := v_end - INTERVAL '30 days';
  ELSIF p_period = '90d' THEN
    v_start := v_end - INTERVAL '90 days';
  ELSIF p_period = 'calendar_year' THEN
    v_start := date_trunc('year', v_end);
  ELSIF p_period = 'rolling_year' THEN
    v_start := v_end - INTERVAL '365 days';
  ELSIF p_period = 'custom' THEN
    IF p_start_date IS NULL OR p_end_date IS NULL THEN
      RAISE EXCEPTION 'custom baseline period requires both p_start_date and p_end_date';
    END IF;
    v_start := p_start_date;
    v_end := p_end_date;
  ELSE
    RAISE EXCEPTION 'Unknown baseline period: %', p_period;
  END IF;

  WITH scoped_activities AS (
    SELECT a.id, a.title, a.activity_date
    FROM public.activities a
    WHERE a.user_id = p_user_id
      AND (a.user_id = auth.uid() OR public.is_coach_of(a.user_id))
      AND a.activity_date >= v_start
      AND a.activity_date <= v_end
  ),
  curve_points AS (
    SELECT
      ac.curve_type,
      kv.key AS duration_key,
      (kv.value)::NUMERIC AS value,
      sa.id AS activity_id,
      sa.title AS activity_title,
      sa.activity_date
    FROM public.activity_curves ac
    JOIN scoped_activities sa ON sa.id = ac.activity_id
    CROSS JOIN LATERAL jsonb_each_text(ac.data) AS kv(key, value)
    WHERE kv.value IS NOT NULL AND kv.value <> 'null'
  ),
  ranked AS (
    -- Best value per metric/duration; ties favour the earliest activity.
    SELECT DISTINCT ON (curve_type, duration_key)
      curve_type, duration_key, value, activity_id, activity_title, activity_date
    FROM curve_points
    ORDER BY curve_type, duration_key, value DESC, activity_date ASC
  ),
  metric_objects AS (
    SELECT
      curve_type,
      jsonb_object_agg(
        duration_key,
        jsonb_build_object(
          'value', value,
          'activityId', activity_id,
          'activityTitle', activity_title,
          'activityDate', activity_date
        )
      ) AS durations
    FROM ranked
    GROUP BY curve_type
  )
  SELECT COALESCE(jsonb_object_agg(curve_type, durations), '{}'::JSONB)
  INTO v_curves
  FROM metric_objects;

  RETURN jsonb_build_object(
    'period', p_period,
    'start', v_start,
    'end', v_end,
    'curves', v_curves
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_athlete_baseline_curves(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_athlete_baseline_curves(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
