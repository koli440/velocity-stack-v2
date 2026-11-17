-- Payment visibility: coaches and athletes see who pays / is paid inside the app (never card data).
--  * Subscriptions remember amount, currency, interval and trial end; the ledger remembers the package and a receipt link.
--  * Notifications carry a small payment_info JSON (amount, package, role) so they can name the amount.
--  * Read RPCs are owner-scoped (a party of the subscription / ledger row) and need no coach_module flag, so existing
--    paying athletes keep seeing their payments.
-- Additive and idempotent.

ALTER TABLE public.coach_subscriptions
    ADD COLUMN IF NOT EXISTS amount_cents BIGINT,
    ADD COLUMN IF NOT EXISTS currency TEXT,
    ADD COLUMN IF NOT EXISTS billing_interval TEXT,
    ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;
ALTER TABLE public.payments_ledger
    ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
    ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES public.coach_packages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS receipt_url TEXT;
CREATE INDEX IF NOT EXISTS idx_payments_ledger_rider ON public.payments_ledger (rider_id, created_at DESC);
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS payment_info JSONB;

DROP FUNCTION IF EXISTS public.billing_apply_subscription(text, text, text, timestamptz, boolean, uuid, uuid, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.billing_apply_subscription(
    p_sub TEXT, p_customer TEXT, p_status TEXT, p_period_end TIMESTAMPTZ, p_cancel_at_end BOOLEAN,
    p_coach UUID, p_rider UUID, p_relationship UUID, p_package UUID, p_account TEXT DEFAULT NULL,
    p_amount BIGINT DEFAULT NULL, p_currency TEXT DEFAULT NULL, p_interval TEXT DEFAULT NULL, p_trial_end TIMESTAMPTZ DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    old public.coach_subscriptions;
    cur public.coach_subscriptions;
    v_coach UUID := p_coach;
    v_rider UUID := p_rider;
    v_rel UUID := p_relationship;
    v_amount BIGINT := CASE WHEN p_amount BETWEEN 0 AND 100000000 THEN p_amount END;
    v_currency TEXT := CASE WHEN p_currency ~ '^[A-Za-z]{3}$' THEN lower(p_currency) END;
    v_interval TEXT := CASE WHEN p_interval IN ('month', 'quarter', 'year') THEN p_interval END;
    v_title TEXT;
    v_info JSONB;
BEGIN
    IF p_account IS NOT NULL THEN
        SELECT coach_id INTO v_coach FROM public.coach_billing_accounts WHERE stripe_account_id = p_account;
        IF v_coach IS NULL THEN RETURN; END IF;
    END IF;
    SELECT * INTO old FROM public.coach_subscriptions WHERE stripe_subscription_id = p_sub;
    IF FOUND THEN
        IF p_account IS NOT NULL AND old.coach_id <> v_coach THEN RETURN; END IF;
        v_coach := old.coach_id; v_rider := old.rider_id;
        UPDATE public.coach_subscriptions SET status = p_status, current_period_end = COALESCE(p_period_end, current_period_end),
            cancel_at_period_end = COALESCE(p_cancel_at_end, FALSE), stripe_customer_id = COALESCE(p_customer, stripe_customer_id),
            amount_cents = COALESCE(v_amount, amount_cents), currency = COALESCE(v_currency, currency),
            billing_interval = COALESCE(v_interval, billing_interval), trial_end = p_trial_end,
            updated_at = NOW() WHERE id = old.id;
    ELSE
        IF v_coach IS NULL OR v_rider IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_coach)
           OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_rider) THEN
            RETURN;
        END IF;
        IF v_rel IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.coaching_relationships WHERE id = v_rel AND coach_id = v_coach AND rider_id = v_rider) THEN
            v_rel := NULL;
        END IF;
        INSERT INTO public.coach_subscriptions (relationship_id, package_id, rider_id, coach_id, stripe_subscription_id,
                                                stripe_customer_id, status, current_period_end, cancel_at_period_end,
                                                amount_cents, currency, billing_interval, trial_end)
        VALUES (v_rel, p_package, v_rider, v_coach, p_sub, p_customer, p_status, p_period_end, COALESCE(p_cancel_at_end, FALSE),
                v_amount, v_currency, v_interval, p_trial_end);
    END IF;
    IF p_customer ~ '^cus_[A-Za-z0-9]+$' THEN
        INSERT INTO public.coach_rider_customers (coach_id, rider_id, stripe_account_id, stripe_customer_id)
        SELECT v_coach, v_rider, a.stripe_account_id, p_customer FROM public.coach_billing_accounts a WHERE a.coach_id = v_coach
        ON CONFLICT DO NOTHING;
    END IF;
    SELECT * INTO cur FROM public.coach_subscriptions WHERE stripe_subscription_id = p_sub;
    SELECT title INTO v_title FROM public.coach_packages WHERE id = cur.package_id;
    v_info := jsonb_build_object('amount_cents', cur.amount_cents, 'currency', cur.currency, 'interval', cur.billing_interval,
                                 'package_title', v_title, 'role', 'coach');
    IF p_status IN ('active', 'trialing') AND (old.id IS NULL OR old.status NOT IN ('active', 'trialing')) THEN
        INSERT INTO public.notifications (user_id, actor_id, type, payment_info) VALUES (v_coach, v_rider, 'subscription_started', v_info);
    ELSIF p_status = 'canceled' AND old.id IS NOT NULL AND old.status <> 'canceled' THEN
        INSERT INTO public.notifications (user_id, actor_id, type, payment_info) VALUES (v_coach, v_rider, 'subscription_ended', v_info);
    END IF;
END $$;

DROP FUNCTION IF EXISTS public.billing_apply_payment(text, text, text, bigint, text, bigint, text);

CREATE OR REPLACE FUNCTION public.billing_apply_payment(
    p_event TEXT, p_sub TEXT, p_kind TEXT, p_amount BIGINT, p_currency TEXT, p_fee BIGINT, p_account TEXT DEFAULT NULL,
    p_package UUID DEFAULT NULL, p_receipt TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    s public.coach_subscriptions;
    v_coach UUID;
    v_rider UUID;
    v_acct_coach UUID;
    v_pkg UUID;
    v_title TEXT;
    v_interval TEXT;
    v_amount BIGINT := GREATEST(COALESCE(p_amount, 0), 0);
    v_currency TEXT := lower(COALESCE(p_currency, 'eur'));
    v_receipt TEXT := CASE WHEN p_receipt ~ '^https://[A-Za-z0-9.-]*stripe\.com/' THEN p_receipt END;
    v_info JSONB;
BEGIN
    IF p_kind NOT IN ('payment', 'failed', 'refund', 'dispute') THEN RAISE EXCEPTION 'Invalid kind'; END IF;
    IF p_account IS NOT NULL THEN
        SELECT coach_id INTO v_acct_coach FROM public.coach_billing_accounts WHERE stripe_account_id = p_account;
        IF v_acct_coach IS NULL THEN RETURN; END IF;
    END IF;
    SELECT * INTO s FROM public.coach_subscriptions WHERE stripe_subscription_id = p_sub;
    IF FOUND THEN
        IF v_acct_coach IS NOT NULL AND s.coach_id <> v_acct_coach THEN RETURN; END IF;
        v_coach := s.coach_id; v_rider := s.rider_id; v_pkg := s.package_id; v_interval := s.billing_interval;
    ELSE
        v_coach := v_acct_coach;
        SELECT id INTO v_pkg FROM public.coach_packages WHERE id = p_package AND coach_id = v_coach;
    END IF;
    IF v_coach IS NULL THEN RETURN; END IF;
    INSERT INTO public.payments_ledger (stripe_event_id, coach_id, rider_id, amount_cents, currency, fee_cents, kind,
                                        stripe_subscription_id, package_id, receipt_url)
    VALUES (p_event, v_coach, v_rider, v_amount, v_currency, GREATEST(COALESCE(p_fee, 0), 0), p_kind,
            NULLIF(p_sub, ''), v_pkg, v_receipt)
    ON CONFLICT (stripe_event_id) DO NOTHING;
    IF FOUND AND p_kind = 'failed' THEN
        SELECT title INTO v_title FROM public.coach_packages WHERE id = v_pkg;
        v_info := jsonb_build_object('amount_cents', v_amount, 'currency', v_currency, 'interval', v_interval,
                                     'package_title', v_title);
        INSERT INTO public.notifications (user_id, actor_id, type, payment_info)
        VALUES (v_coach, v_rider, 'payment_failed', v_info || '{"role":"coach"}'::JSONB);
        IF v_rider IS NOT NULL THEN
            INSERT INTO public.notifications (user_id, actor_id, type, payment_info)
            VALUES (v_rider, v_coach, 'payment_failed', v_info || '{"role":"rider"}'::JSONB);
        END IF;
    END IF;
END $$;

DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'billing_apply_subscription(text,text,text,timestamptz,boolean,uuid,uuid,uuid,uuid,text,bigint,text,text,timestamptz)',
        'billing_apply_payment(text,text,text,bigint,text,bigint,text,uuid,text)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Owner-scoped reads. Only parties of a subscription / ledger row ever see it; no flag required.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_payment_overview()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    RETURN jsonb_build_object(
        'as_rider', COALESCE((
            SELECT jsonb_agg(x.j ORDER BY x.at DESC) FROM (
                SELECT s.created_at AS at, jsonb_build_object('id', s.id, 'counterparty_id', s.coach_id, 'relationship_id', s.relationship_id,
                    'package_title', p.title, 'amount_cents', COALESCE(s.amount_cents, p.amount_cents), 'currency', COALESCE(s.currency, p.currency),
                    'interval', COALESCE(s.billing_interval, p.billing_interval), 'status', s.status, 'trial_end', s.trial_end,
                    'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end,
                    'last_payment', (SELECT jsonb_build_object('kind', l.kind, 'amount_cents', l.amount_cents, 'currency', l.currency, 'at', l.created_at)
                                     FROM public.payments_ledger l WHERE l.stripe_subscription_id = s.stripe_subscription_id
                                     ORDER BY l.created_at DESC LIMIT 1)) AS j
                FROM public.coach_subscriptions s LEFT JOIN public.coach_packages p ON p.id = s.package_id
                WHERE s.rider_id = v_me ORDER BY s.created_at DESC LIMIT 100) x), '[]'::JSONB),
        'as_coach', COALESCE((
            SELECT jsonb_agg(x.j ORDER BY x.at DESC) FROM (
                SELECT s.created_at AS at, jsonb_build_object('id', s.id, 'counterparty_id', s.rider_id, 'relationship_id', s.relationship_id,
                    'package_title', p.title, 'amount_cents', COALESCE(s.amount_cents, p.amount_cents), 'currency', COALESCE(s.currency, p.currency),
                    'interval', COALESCE(s.billing_interval, p.billing_interval), 'status', s.status, 'trial_end', s.trial_end,
                    'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end,
                    'last_payment', (SELECT jsonb_build_object('kind', l.kind, 'amount_cents', l.amount_cents, 'currency', l.currency, 'at', l.created_at)
                                     FROM public.payments_ledger l WHERE l.stripe_subscription_id = s.stripe_subscription_id
                                     ORDER BY l.created_at DESC LIMIT 1)) AS j
                FROM public.coach_subscriptions s LEFT JOIN public.coach_packages p ON p.id = s.package_id
                WHERE s.coach_id = v_me ORDER BY s.created_at DESC LIMIT 200) x), '[]'::JSONB));
END $$;

-- p_role 'rider' = what I paid, 'coach' = what I received. Month totals are gross (before Stripe's fees, which the
-- ledger does not know); refunds of the month are reported separately.
CREATE OR REPLACE FUNCTION public.my_payments(p_role TEXT, p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    IF p_role NOT IN ('rider', 'coach') THEN RAISE EXCEPTION 'Invalid role'; END IF;
    RETURN jsonb_build_object(
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', x.id, 'created_at', x.created_at,
                'counterparty_id', CASE WHEN p_role = 'coach' THEN x.rider_id ELSE x.coach_id END,
                'package_title', x.title, 'amount_cents', x.amount_cents, 'currency', x.currency, 'kind', x.kind,
                'receipt_url', x.receipt_url) ORDER BY x.created_at DESC)
            FROM (SELECT l.*, p.title FROM public.payments_ledger l LEFT JOIN public.coach_packages p ON p.id = l.package_id
                  WHERE (p_role = 'coach' AND l.coach_id = v_me) OR (p_role = 'rider' AND l.rider_id = v_me)
                  ORDER BY l.created_at DESC LIMIT v_limit) x), '[]'::JSONB),
        'month_totals', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('currency', t.currency, 'gross_cents', t.gross, 'refunded_cents', t.refunded))
            FROM (SELECT l.currency,
                         COALESCE(SUM(l.amount_cents) FILTER (WHERE l.kind = 'payment'), 0) AS gross,
                         COALESCE(SUM(l.amount_cents) FILTER (WHERE l.kind = 'refund'), 0) AS refunded
                  FROM public.payments_ledger l
                  WHERE ((p_role = 'coach' AND l.coach_id = v_me) OR (p_role = 'rider' AND l.rider_id = v_me))
                    AND l.created_at >= date_trunc('month', NOW())
                  GROUP BY l.currency) t), '[]'::JSONB));
END $$;

REVOKE ALL ON FUNCTION public.my_payment_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_payments(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_payment_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_payments(text, integer) TO authenticated;
