// Adversarial checks for 20270183000000_coach_billing_direct_charges.sql. Run with harness.mjs, see README.
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
  for (const n of ['admin', 'coach', 'coach2', 'rider', 'rider2']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  const svc = (sql, params = []) => as(c, null, sql, params, { commit: true, role: 'service_role' })
  const user = (u, sql, params = []) => as(c, U[u], sql, params, { commit: true })
  for (const n of ['coach', 'coach2', 'rider', 'rider2']) await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U[n]], { commit: true })
  await user('coach', `SELECT save_coach_card($1::jsonb)`, [JSON.stringify({ slug: 'dc-one', headline: 'h' })])
  await user('coach2', `SELECT save_coach_card($1::jsonb)`, [JSON.stringify({ slug: 'dc-two', headline: 'h' })])
  await svc(`SELECT billing_set_account($1, 'acct_one')`, [U.coach])
  await svc(`SELECT billing_set_account($1, 'acct_two')`, [U.coach2])

  for (const q of [`SELECT billing_get_customer('${U.coach}','${U.rider}')`, `SELECT billing_set_customer('${U.coach}','${U.rider}','cus_1')`, `SELECT * FROM coach_rider_customers`]) {
    ok('client denied: ' + q.slice(0, 40), !(await user('coach', q)).ok && !(await as(c, null, q)).ok)
  }

  ok('invalid customer refused', !(await svc(`SELECT billing_set_customer($1,$2,'bad')`, [U.coach, U.rider])).ok)
  ok('customer needs an account', !(await svc(`SELECT billing_set_customer($1,$2,'cus_x')`, [U.admin, U.rider])).ok)
  ok('customer stored', (await svc(`SELECT billing_set_customer($1,$2,'cus_1') x`, [U.coach, U.rider])).rows[0].x === 'cus_1')
  ok('first customer wins', (await svc(`SELECT billing_set_customer($1,$2,'cus_2') x`, [U.coach, U.rider])).rows[0].x === 'cus_1')
  ok('customers are per coach account', (await svc(`SELECT billing_get_customer($1,$2) x`, [U.coach2, U.rider])).rows[0].x === null)
  ok('portal lookup returns coach account', (await svc(`SELECT billing_rider_customer($1,$2) x`, [U.rider, U.coach])).rows[0].x.stripe_account_id === 'acct_one')
  ok('portal lookup scoped to coach', (await svc(`SELECT billing_rider_customer($1,$2) x`, [U.rider, U.coach2])).rows[0].x === null)

  const apply = (sub, account, extra = {}) => svc(`SELECT billing_apply_subscription($1,$2,'active',NOW()+interval '30 days',false,$3,$4,NULL,NULL,$5)`,
    [sub, extra.customer ?? 'cus_9', extra.coach ?? U.coach, U.rider2, account])
  ok('unknown account ignored', (await apply('sub_a', 'acct_nope')).ok && (await c.query(`SELECT count(*)::int n FROM coach_subscriptions`)).rows[0].n === 0)
  await apply('sub_a', 'acct_one', { coach: U.coach2 })
  const row = (await c.query(`SELECT coach_id FROM coach_subscriptions WHERE stripe_subscription_id='sub_a'`)).rows[0]
  ok('coach comes from the account, not metadata', row && row.coach_id === U.coach)
  await apply('sub_a', 'acct_two')
  ok('another account cannot touch the subscription', (await c.query(`SELECT coach_id, status FROM coach_subscriptions WHERE stripe_subscription_id='sub_a'`)).rows[0].coach_id === U.coach)
  ok('subscription customer mapped per coach', (await svc(`SELECT billing_get_customer($1,$2) x`, [U.coach, U.rider2])).rows[0].x === 'cus_9')

  const pay = (ev, sub, acct, kind = 'payment') => svc(`SELECT billing_apply_payment($1,$2,$3,5000,'eur',0,$4)`, [ev, sub, kind, acct])
  await pay('e1', 'sub_a', 'acct_one'); await pay('e1', 'sub_a', 'acct_one')
  ok('ledger idempotent', (await c.query(`SELECT count(*)::int n FROM payments_ledger`)).rows[0].n === 1)
  await pay('e2', 'sub_a', 'acct_two')
  ok('payment of another coach account ignored', (await c.query(`SELECT count(*)::int n FROM payments_ledger`)).rows[0].n === 1)
  await pay('e3', '', 'acct_two', 'refund')
  ok('one-time refund mapped through the account', (await c.query(`SELECT coach_id FROM payments_ledger WHERE stripe_event_id='e3'`)).rows[0].coach_id === U.coach2)
  await pay('e4', '', 'acct_nope', 'refund')
  ok('unknown account payment ignored', (await c.query(`SELECT count(*)::int n FROM payments_ledger`)).rows[0].n === 2)
}
