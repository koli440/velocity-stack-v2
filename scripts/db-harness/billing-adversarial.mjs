// Adversarial checks for 20270156000000_coach_billing.sql (Stripe Connect records). Run with harness.mjs, see README.
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
async function as(c, user, sql, params = [], { commit = false, role } = {}) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${role || (user ? 'authenticated' : 'anon')}`)
    if (user) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query(commit ? 'COMMIT' : 'ROLLBACK')
    return { ok: true, rows: r.rows }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }

export async function run(c) {
  for (const n of ['admin', 'coach', 'rider', 'minor', 'stranger', 'other']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  const svc = (sql, params = []) => as(c, null, sql, params, { commit: true, role: 'service_role' })
  const user = (u, sql, params = []) => as(c, U[u], sql, params, { commit: true })
  const allow = (u) => as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U[u]], { commit: true })

  // Flag off: coach cannot read billing, service helpers refuse onboarding.
  ok('billing status refused while flag off', !(await user('coach', `SELECT my_billing_status()`)).ok)
  ok('set_account refused while flag off', !(await svc(`SELECT billing_set_account($1, 'acct_123')`, [U.coach])).ok)
  for (const n of ['coach', 'rider', 'minor', 'other']) await allow(n)
  await user('coach', `SELECT save_coach_card($1::jsonb)`, [JSON.stringify({ slug: 'coach-one', headline: 'h' })])
  await user('coach', `SELECT set_coach_card_visibility(true, false)`)
  const pkg = async (kind, amount, active = true) => (await c.query(
    `INSERT INTO coach_packages (coach_id, title, kind, billing_interval, amount_cents, is_active) VALUES ($1,'Plan',$2,$3,$4,$5) RETURNING id`,
    [U.coach, kind, kind === 'subscription' ? 'month' : null, amount, active])).rows[0].id
  const sub = await pkg('subscription', 9000)
  const free = await pkg('free', null)
  const inactive = await pkg('subscription', 9000, false)

  // Client cannot reach server functions or tables.
  for (const q of [`SELECT billing_set_account('${U.coach}', 'acct_1')`, `SELECT billing_record_event('e', 't')`,
    `SELECT billing_checkout_context('${U.rider}', '${sub}')`, `SELECT billing_apply_payment('e','s','payment',1,'eur',0,NULL)`,
    `SELECT * FROM coach_billing_accounts`, `SELECT * FROM coach_subscriptions`, `SELECT * FROM payments_ledger`,
    `SELECT * FROM stripe_events`, `INSERT INTO coach_subscriptions(rider_id,coach_id,stripe_subscription_id,status) VALUES (gen_random_uuid(),gen_random_uuid(),'x','active')`]) {
    ok('authenticated denied: ' + q.slice(0, 40), !(await user('coach', q)).ok)
    ok('anon denied: ' + q.slice(0, 40), !(await as(c, null, q)).ok)
  }

  // Connect onboarding
  ok('invalid account id refused', !(await svc(`SELECT billing_set_account($1, 'bad id')`, [U.coach])).ok)
  ok('set account', (await svc(`SELECT billing_set_account($1, 'acct_abc', 'DE')`, [U.coach])).ok)
  ok('set account is idempotent and keeps the first', (await svc(`SELECT billing_set_account($1, 'acct_zzz')`, [U.coach])).ok
    && (await svc(`SELECT billing_get_account($1) a`, [U.coach])).rows[0].a === 'acct_abc')
  ok('status shows not yet chargeable', (await user('coach', `SELECT my_billing_status() s`)).rows[0].s.charges_enabled === false)

  // Checkout rules
  const ctx = (rider, pk) => svc(`SELECT billing_checkout_context($1,$2) x`, [U[rider] ?? rider, pk])
  await c.query(`INSERT INTO coaching_relationships (coach_id, rider_id, status, initiated_by) VALUES ($1,$2,'active',$2)`, [U.coach, U.rider])
  ok('refused until charges enabled', !(await ctx('rider', sub)).ok)
  ok('account.updated applies', (await svc(`SELECT billing_apply_account('acct_abc', true, true, true, 'DE') ok`)).rows[0].ok === true)
  ok('unknown account ignored', (await svc(`SELECT billing_apply_account('acct_nope', true, true, true, 'DE') ok`)).rows[0].ok === false)
  const good = await ctx('rider', sub)
  ok('valid checkout context', good.ok && good.rows[0].x.amount_cents === 9000 && good.rows[0].x.stripe_account_id === 'acct_abc')
  ok('free package refused', !(await ctx('rider', free)).ok)
  ok('inactive package refused', !(await ctx('rider', inactive)).ok)
  ok('own package refused', !(await ctx('coach', sub)).ok)
  ok('stranger without relationship refused', !(await ctx('stranger', sub)).ok)
  await allow('stranger')
  ok('rider with flag but no relationship refused', !(await ctx('stranger', sub)).ok)
  await c.query(`INSERT INTO coaching_relationships (coach_id, rider_id, status, initiated_by) VALUES ($1,$2,'pending',$2)`, [U.coach, U.other])
  ok('pending relationship refused', !(await ctx('other', sub)).ok)
  await c.query(`INSERT INTO coaching_relationships (coach_id, rider_id, status, initiated_by) VALUES ($1,$2,'active',$2)`, [U.coach, U.minor])
  await c.query(`INSERT INTO onboarding_submissions (coach_id, rider_id, answers, consent_at, consent_version, consent_text_hash) VALUES ($1,$2,$3::jsonb,NOW(),1,$4)`,
    [U.coach, U.minor, JSON.stringify({ about: { dob: new Date(Date.now() - 15 * 365 * 864e5).toISOString().slice(0, 10) } }), 'a'.repeat(64)])
  ok('under-18 refused', !(await ctx('minor', sub)).ok)
  await c.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)`, [U.rider, U.coach]).catch(() => {})
  const blocked = await ctx('rider', sub)
  ok('block respected (or no block table in harness)', !blocked.ok || (await c.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name='blocks'`)).rows[0].n === 0)
  await c.query(`DELETE FROM blocks WHERE blocker_id = $1`, [U.rider]).catch(() => {})
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, false)`, [U.rider], { commit: true })
  ok('rider flag off refused', !(await ctx('rider', sub)).ok)
  await allow('rider')

  // Webhook idempotency
  ok('first event is new', (await svc(`SELECT billing_record_event('evt_1','invoice.paid') n`)).rows[0].n === true)
  ok('replay is not new', (await svc(`SELECT billing_record_event('evt_1','invoice.paid') n`)).rows[0].n === false)
  await svc(`SELECT billing_forget_event('evt_1')`)
  ok('unfinished event can be retried', (await svc(`SELECT billing_record_event('evt_1','invoice.paid') n`)).rows[0].n === true)
  await svc(`SELECT billing_finish_event('evt_1', NULL)`)
  await svc(`SELECT billing_forget_event('evt_1')`)
  ok('processed event is kept', (await svc(`SELECT billing_record_event('evt_1','invoice.paid') n`)).rows[0].n === false)

  // Subscriptions + payments
  const apply = (status, extra = {}) => svc(`SELECT billing_apply_subscription($1,'cus_1',$2,NOW()+interval '30 days',$3,$4,$5,$6,$7)`,
    ['sub_1', status, extra.cancel ?? false, extra.coach ?? U.coach, extra.rider ?? U.rider, null, sub])
  ok('subscription created', (await apply('active')).ok)
  const n = async (t) => (await c.query(`SELECT count(*)::int n FROM notifications WHERE type=$1 AND user_id=$2`, [t, U.coach])).rows[0].n
  ok('coach notified once of start', (await n('subscription_started')) === 1)
  await apply('active')
  ok('no duplicate start notification', (await n('subscription_started')) === 1)
  await apply('active', { coach: U.other, rider: U.stranger })
  const row = (await c.query(`SELECT coach_id, rider_id FROM coach_subscriptions WHERE stripe_subscription_id='sub_1'`)).rows[0]
  ok('later events cannot move a subscription', row.coach_id === U.coach && row.rider_id === U.rider)
  ok('unknown pair ignored', (await svc(`SELECT billing_apply_subscription('sub_x','c','active',NULL,false,gen_random_uuid(),gen_random_uuid(),NULL,NULL)`)).ok
    && (await c.query(`SELECT count(*)::int n FROM coach_subscriptions`)).rows[0].n === 1)
  const pay = (ev, kind) => svc(`SELECT billing_apply_payment($1,'sub_1',$2,9000,'EUR',0,NULL)`, [ev, kind])
  await pay('evt_p1', 'payment'); await pay('evt_p1', 'payment')
  ok('ledger idempotent', (await c.query(`SELECT count(*)::int n FROM payments_ledger`)).rows[0].n === 1)
  ok('currency lower-cased', (await c.query(`SELECT currency FROM payments_ledger`)).rows[0].currency === 'eur')
  await pay('evt_f1', 'failed'); await pay('evt_f1', 'failed')
  ok('failed payment notifies coach once', (await n('payment_failed')) === 1)
  ok('invalid kind refused', !(await pay('evt_z', 'bogus')).ok)
  await apply('canceled')
  ok('end notification', (await n('subscription_ended')) === 1)

  // Visibility
  const cs = (await user('coach', `SELECT my_billing_status() s`)).rows[0].s
  ok('coach sees own subscription only', cs.subscriptions.length === 1 && cs.charges_enabled === true)
  ok('rider sees own subscription', (await user('rider', `SELECT my_rider_subscriptions() s`)).rows[0].s.length === 1)
  ok('other rider sees none', (await user('other', `SELECT my_rider_subscriptions() s`)).rows[0].s.length === 0)
  ok('other coach sees nothing of this coach', (await user('other', `SELECT my_billing_status() s`)).rows[0].s.subscriptions.length === 0)
  ok('rider customer lookup', (await svc(`SELECT billing_rider_customer($1) x`, [U.rider])).rows[0].x.customer === 'cus_1')
  ok('stranger customer lookup empty', (await svc(`SELECT billing_rider_customer($1) x`, [U.stranger])).rows[0].x === null)
  ok('prune keeps recent', (await c.query(`SELECT stripe_events_prune() n`)).rows[0].n === 0)
}
