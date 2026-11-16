-- Coach module, phase 4: Stripe Connect billing records (test mode first; secrets live only in the server environment).
--  * The database never holds Stripe secrets. Tables are written only by the service role through the narrow
--    functions below (executable by service_role only); coaches and riders can read just their own rows.
--  * Access to coaching is NOT gated by payment; payment status is informational for the coach.
--  * Checkout is refused for under-18 applicants until a guardian policy exists (spec 10.4).
--  * Everything is dark behind the coach_module flag (checked for both parties in billing_checkout_context).
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.coach_billing_accounts (
    coach_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    stripe_account_id TEXT NOT NULL UNIQUE,
    charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    details_submitted BOOLEAN NOT NULL DEFAULT FALSE,
    country TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.coach_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id UUID REFERENCES public.coaching_relationships(id) ON DELETE SET NULL,
    package_id UUID REFERENCES public.coach_packages(id) ON DELETE SET NULL,
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    coach_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    stripe_subscription_id TEXT NOT NULL UNIQUE,
    stripe_customer_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coach_subscriptions_coach ON public.coach_subscriptions (coach_id, status);
CREATE INDEX IF NOT EXISTS idx_coach_subscriptions_rider ON public.coach_subscriptions (rider_id, status);

CREATE TABLE IF NOT EXISTS public.payments_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_event_id TEXT NOT NULL UNIQUE,
    coach_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rider_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    amount_cents BIGINT NOT NULL,
    currency TEXT NOT NULL CHECK (char_length(currency) = 3),
    fee_cents BIGINT NOT NULL DEFAULT 0,
    kind TEXT NOT NULL CHECK (kind IN ('payment', 'failed', 'refund', 'dispute')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_ledger_coach ON public.payments_ledger (coach_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stripe_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    error TEXT
);

ALTER TABLE public.coach_billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_billing_accounts, public.coach_subscriptions, public.payments_ledger, public.stripe_events
    FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Client-facing reads (RPC only, flag enforced).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_billing_status()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    a public.coach_billing_accounts;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.coach_module_require();
    SELECT * INTO a FROM public.coach_billing_accounts WHERE coach_id = v_me;
    RETURN jsonb_build_object(
        'connected', a.coach_id IS NOT NULL,
        'charges_enabled', COALESCE(a.charges_enabled, FALSE),
        'payouts_enabled', COALESCE(a.payouts_enabled, FALSE),
        'details_submitted', COALESCE(a.details_submitted, FALSE),
        'subscriptions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', s.id, 'rider_id', s.rider_id, 'status', s.status,
                'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end,
                'package_title', p.title) ORDER BY s.created_at DESC)
            FROM public.coach_subscriptions s LEFT JOIN public.coach_packages p ON p.id = s.package_id
            WHERE s.coach_id = v_me), '[]'::JSONB));
END $$;

-- The rider's own subscriptions (so they can see what they pay for; managing happens in Stripe's portal).
CREATE OR REPLACE FUNCTION public.my_rider_subscriptions()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.coach_module_require();
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', s.id, 'coach_id', s.coach_id, 'status', s.status,
            'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end,
            'package_title', p.title) ORDER BY s.created_at DESC)
        FROM public.coach_subscriptions s LEFT JOIN public.coach_packages p ON p.id = s.package_id
        WHERE s.rider_id = auth.uid()), '[]'::JSONB);
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Server-side functions (service role only; the API routes verify the user / Stripe signature first).
-- ---------------------------------------------------------------------------------------------------------------------
-- True when the coach may start Connect onboarding.
CREATE OR REPLACE FUNCTION public.billing_coach_ready(p_coach UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT public.coach_module_enabled(p_coach) AND EXISTS (SELECT 1 FROM public.coach_cards WHERE coach_id = p_coach)
$$;

CREATE OR REPLACE FUNCTION public.billing_set_account(p_coach UUID, p_account TEXT, p_country TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_account IS NULL OR p_account !~ '^acct_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'Invalid account'; END IF;
    IF NOT public.billing_coach_ready(p_coach) THEN RAISE EXCEPTION 'Coach module not enabled'; END IF;
    INSERT INTO public.coach_billing_accounts (coach_id, stripe_account_id, country)
    VALUES (p_coach, p_account, p_country)
    ON CONFLICT (coach_id) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.billing_get_account(p_coach UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT stripe_account_id FROM public.coach_billing_accounts WHERE coach_id = p_coach
$$;

-- account.updated
CREATE OR REPLACE FUNCTION public.billing_apply_account(p_account TEXT, p_charges BOOLEAN, p_payouts BOOLEAN, p_details BOOLEAN, p_country TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.coach_billing_accounts
        SET charges_enabled = COALESCE(p_charges, FALSE), payouts_enabled = COALESCE(p_payouts, FALSE),
            details_submitted = COALESCE(p_details, FALSE), country = COALESCE(p_country, country), updated_at = NOW()
        WHERE stripe_account_id = p_account;
    RETURN FOUND;
END $$;

-- Idempotency: TRUE only the first time an event id is seen.
CREATE OR REPLACE FUNCTION public.billing_record_event(p_id TEXT, p_type TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INTEGER;
BEGIN
    INSERT INTO public.stripe_events (id, type) VALUES (p_id, p_type) ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n = 1;
END $$;

CREATE OR REPLACE FUNCTION public.billing_finish_event(p_id TEXT, p_error TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE public.stripe_events SET processed_at = NOW(), error = left(p_error, 300) WHERE id = p_id
$$;

-- A failed event is removed from the idempotency table so Stripe's retry is processed again.
CREATE OR REPLACE FUNCTION public.billing_forget_event(p_id TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM public.stripe_events WHERE id = p_id AND processed_at IS NULL
$$;

-- Everything the checkout route needs, with all authorisation rules in one place.
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
        'amount_cents', pk.amount_cents, 'currency', pk.currency);
END $$;

-- Latest Stripe customer of a rider for portal sessions (own subscriptions only; the route passes the verified user id).
CREATE OR REPLACE FUNCTION public.billing_rider_customer(p_rider UUID, p_coach UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object('customer', s.stripe_customer_id, 'stripe_account_id', a.stripe_account_id)
    FROM public.coach_subscriptions s JOIN public.coach_billing_accounts a ON a.coach_id = s.coach_id
    WHERE s.rider_id = p_rider AND s.stripe_customer_id IS NOT NULL AND (p_coach IS NULL OR s.coach_id = p_coach)
    ORDER BY s.created_at DESC LIMIT 1
$$;

-- customer.subscription.* and checkout.session.completed (subscription mode)
CREATE OR REPLACE FUNCTION public.billing_apply_subscription(
    p_sub TEXT, p_customer TEXT, p_status TEXT, p_period_end TIMESTAMPTZ, p_cancel_at_end BOOLEAN,
    p_coach UUID, p_rider UUID, p_relationship UUID, p_package UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    old public.coach_subscriptions;
    v_coach UUID := p_coach;
    v_rider UUID := p_rider;
BEGIN
    SELECT * INTO old FROM public.coach_subscriptions WHERE stripe_subscription_id = p_sub;
    IF FOUND THEN
        -- Ownership comes from the first record; later events cannot move a subscription to another pair.
        v_coach := old.coach_id; v_rider := old.rider_id;
        UPDATE public.coach_subscriptions SET status = p_status, current_period_end = COALESCE(p_period_end, current_period_end),
            cancel_at_period_end = COALESCE(p_cancel_at_end, FALSE), stripe_customer_id = COALESCE(p_customer, stripe_customer_id),
            updated_at = NOW() WHERE id = old.id;
    ELSE
        IF v_coach IS NULL OR v_rider IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_coach)
           OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_rider) THEN
            RETURN;
        END IF;
        INSERT INTO public.coach_subscriptions (relationship_id, package_id, rider_id, coach_id, stripe_subscription_id,
                                                stripe_customer_id, status, current_period_end, cancel_at_period_end)
        VALUES (p_relationship, p_package, v_rider, v_coach, p_sub, p_customer, p_status, p_period_end, COALESCE(p_cancel_at_end, FALSE));
    END IF;
    IF p_status IN ('active', 'trialing') AND (old.id IS NULL OR old.status NOT IN ('active', 'trialing')) THEN
        INSERT INTO public.notifications (user_id, actor_id, type) VALUES (v_coach, v_rider, 'subscription_started');
    ELSIF p_status = 'canceled' AND old.id IS NOT NULL AND old.status <> 'canceled' THEN
        INSERT INTO public.notifications (user_id, actor_id, type) VALUES (v_coach, v_rider, 'subscription_ended');
    END IF;
END $$;

-- invoice.paid / invoice.payment_failed / charge.refunded / charge.dispute.created. Idempotent on the Stripe event id.
CREATE OR REPLACE FUNCTION public.billing_apply_payment(
    p_event TEXT, p_sub TEXT, p_kind TEXT, p_amount BIGINT, p_currency TEXT, p_fee BIGINT, p_account TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    s public.coach_subscriptions;
    v_coach UUID;
    v_rider UUID;
BEGIN
    IF p_kind NOT IN ('payment', 'failed', 'refund', 'dispute') THEN RAISE EXCEPTION 'Invalid kind'; END IF;
    SELECT * INTO s FROM public.coach_subscriptions WHERE stripe_subscription_id = p_sub;
    IF FOUND THEN
        v_coach := s.coach_id; v_rider := s.rider_id;
    ELSIF p_account IS NOT NULL THEN
        SELECT coach_id INTO v_coach FROM public.coach_billing_accounts WHERE stripe_account_id = p_account;
    END IF;
    IF v_coach IS NULL THEN RETURN; END IF;
    INSERT INTO public.payments_ledger (stripe_event_id, coach_id, rider_id, amount_cents, currency, fee_cents, kind)
    VALUES (p_event, v_coach, v_rider, GREATEST(COALESCE(p_amount, 0), 0), lower(COALESCE(p_currency, 'eur')), GREATEST(COALESCE(p_fee, 0), 0), p_kind)
    ON CONFLICT (stripe_event_id) DO NOTHING;
    IF FOUND AND p_kind = 'failed' THEN
        INSERT INTO public.notifications (user_id, actor_id, type) VALUES (v_coach, v_rider, 'payment_failed');
    END IF;
END $$;

DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'billing_coach_ready(uuid)', 'billing_set_account(uuid,text,text)', 'billing_get_account(uuid)',
        'billing_apply_account(text,boolean,boolean,boolean,text)', 'billing_record_event(text,text)',
        'billing_finish_event(text,text)', 'billing_forget_event(text)', 'billing_checkout_context(uuid,uuid)',
        'billing_rider_customer(uuid,uuid)',
        'billing_apply_subscription(text,text,text,timestamptz,boolean,uuid,uuid,uuid,uuid)',
        'billing_apply_payment(text,text,text,bigint,text,bigint,text)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END LOOP;
    FOREACH f IN ARRAY ARRAY['my_billing_status()', 'my_rider_subscriptions()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;

-- Package ids at Stripe (written by the checkout route right after it creates the product/price).
CREATE OR REPLACE FUNCTION public.billing_set_package_stripe(p_package UUID, p_product TEXT, p_price TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE public.coach_packages SET stripe_product_id = p_product, stripe_price_id = p_price WHERE id = p_package
$$;
REVOKE ALL ON FUNCTION public.billing_set_package_stripe(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_set_package_stripe(uuid, text, text) TO service_role;

-- Prune processed idempotency rows after 90 days (SQL-only job).
CREATE OR REPLACE FUNCTION public.stripe_events_prune()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INTEGER;
BEGIN
    DELETE FROM public.stripe_events WHERE received_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.stripe_events_prune() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'stripe-events-prune';
        PERFORM cron.schedule('stripe-events-prune', '40 4 * * *', 'SELECT public.stripe_events_prune()');
    END IF;
END $$;
