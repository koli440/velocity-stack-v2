-- Coach billing: DIRECT charges on the coach's connected (Express) account. The platform does not collect money; the coach
-- is merchant of record. Checkout, customers, subscriptions, portal sessions and refunds live on the connected account.
--  * coach_rider_customers: the Stripe customer id per (coach, rider) on that coach's account.
--  * Connect webhook events carry `account`; billing_apply_* resolve the coach from that account id, never from
--    (coach-controlled) metadata, and a subscription can not be moved to another coach's account.
-- Additive and idempotent. Existing ledger/subscription semantics are unchanged.

CREATE TABLE IF NOT EXISTS public.coach_rider_customers (
    coach_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    stripe_account_id TEXT NOT NULL,
    stripe_customer_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (coach_id, rider_id),
    UNIQUE (stripe_account_id, stripe_customer_id)
);
ALTER TABLE public.coach_rider_customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_rider_customers FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.billing_get_customer(p_coach UUID, p_rider UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT c.stripe_customer_id FROM public.coach_rider_customers c
    JOIN public.coach_billing_accounts a ON a.coach_id = c.coach_id AND a.stripe_account_id = c.stripe_account_id
    WHERE c.coach_id = p_coach AND c.rider_id = p_rider
$$;

-- First writer wins; returns the stored customer id.
CREATE OR REPLACE FUNCTION public.billing_set_customer(p_coach UUID, p_rider UUID, p_customer TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_acct TEXT;
BEGIN
    IF p_customer IS NULL OR p_customer !~ '^cus_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'Invalid customer'; END IF;
    SELECT stripe_account_id INTO v_acct FROM public.coach_billing_accounts WHERE coach_id = p_coach;
    IF v_acct IS NULL THEN RAISE EXCEPTION 'No payment account'; END IF;
    INSERT INTO public.coach_rider_customers (coach_id, rider_id, stripe_account_id, stripe_customer_id)
    VALUES (p_coach, p_rider, v_acct, p_customer)
    ON CONFLICT (coach_id, rider_id) DO NOTHING;
    RETURN public.billing_get_customer(p_coach, p_rider);
END $$;

-- Portal: the customer on the coach's account (customers are per connected account).
CREATE OR REPLACE FUNCTION public.billing_rider_customer(p_rider UUID, p_coach UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object('customer', x.customer, 'stripe_account_id', x.account, 'coach_id', x.coach_id)
    FROM (
        SELECT c.stripe_customer_id AS customer, c.stripe_account_id AS account, c.coach_id, 0 AS pri, c.created_at AS at
        FROM public.coach_rider_customers c
        JOIN public.coach_billing_accounts a ON a.coach_id = c.coach_id AND a.stripe_account_id = c.stripe_account_id
        WHERE c.rider_id = p_rider AND (p_coach IS NULL OR c.coach_id = p_coach)
        UNION ALL
        SELECT s.stripe_customer_id, a.stripe_account_id, s.coach_id, 1, s.created_at
        FROM public.coach_subscriptions s JOIN public.coach_billing_accounts a ON a.coach_id = s.coach_id
        WHERE s.rider_id = p_rider AND s.stripe_customer_id IS NOT NULL AND (p_coach IS NULL OR s.coach_id = p_coach)
    ) x
    ORDER BY x.pri, x.at DESC LIMIT 1
$$;

DROP FUNCTION IF EXISTS public.billing_apply_subscription(text, text, text, timestamptz, boolean, uuid, uuid, uuid, uuid);

-- customer.subscription.*: p_account is the Connect event's `account`; the coach is resolved from it.
CREATE OR REPLACE FUNCTION public.billing_apply_subscription(
    p_sub TEXT, p_customer TEXT, p_status TEXT, p_period_end TIMESTAMPTZ, p_cancel_at_end BOOLEAN,
    p_coach UUID, p_rider UUID, p_relationship UUID, p_package UUID, p_account TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    old public.coach_subscriptions;
    v_coach UUID := p_coach;
    v_rider UUID := p_rider;
    v_rel UUID := p_relationship;
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
                                                stripe_customer_id, status, current_period_end, cancel_at_period_end)
        VALUES (v_rel, p_package, v_rider, v_coach, p_sub, p_customer, p_status, p_period_end, COALESCE(p_cancel_at_end, FALSE));
    END IF;
    IF p_customer ~ '^cus_[A-Za-z0-9]+$' THEN
        INSERT INTO public.coach_rider_customers (coach_id, rider_id, stripe_account_id, stripe_customer_id)
        SELECT v_coach, v_rider, a.stripe_account_id, p_customer FROM public.coach_billing_accounts a WHERE a.coach_id = v_coach
        ON CONFLICT DO NOTHING;
    END IF;
    IF p_status IN ('active', 'trialing') AND (old.id IS NULL OR old.status NOT IN ('active', 'trialing')) THEN
        INSERT INTO public.notifications (user_id, actor_id, type) VALUES (v_coach, v_rider, 'subscription_started');
    ELSIF p_status = 'canceled' AND old.id IS NOT NULL AND old.status <> 'canceled' THEN
        INSERT INTO public.notifications (user_id, actor_id, type) VALUES (v_coach, v_rider, 'subscription_ended');
    END IF;
END $$;

-- Payments/refunds: with p_account the event must belong to that coach's account (a known subscription of another coach is ignored).
CREATE OR REPLACE FUNCTION public.billing_apply_payment(
    p_event TEXT, p_sub TEXT, p_kind TEXT, p_amount BIGINT, p_currency TEXT, p_fee BIGINT, p_account TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    s public.coach_subscriptions;
    v_coach UUID;
    v_rider UUID;
    v_acct_coach UUID;
BEGIN
    IF p_kind NOT IN ('payment', 'failed', 'refund', 'dispute') THEN RAISE EXCEPTION 'Invalid kind'; END IF;
    IF p_account IS NOT NULL THEN
        SELECT coach_id INTO v_acct_coach FROM public.coach_billing_accounts WHERE stripe_account_id = p_account;
        IF v_acct_coach IS NULL THEN RETURN; END IF;
    END IF;
    SELECT * INTO s FROM public.coach_subscriptions WHERE stripe_subscription_id = p_sub;
    IF FOUND THEN
        IF v_acct_coach IS NOT NULL AND s.coach_id <> v_acct_coach THEN RETURN; END IF;
        v_coach := s.coach_id; v_rider := s.rider_id;
    ELSE
        v_coach := v_acct_coach;
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
        'billing_get_customer(uuid,uuid)', 'billing_set_customer(uuid,uuid,text)', 'billing_rider_customer(uuid,uuid)',
        'billing_apply_subscription(text,text,text,timestamptz,boolean,uuid,uuid,uuid,uuid,text)',
        'billing_apply_payment(text,text,text,bigint,text,bigint,text)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END LOOP;
END $$;
