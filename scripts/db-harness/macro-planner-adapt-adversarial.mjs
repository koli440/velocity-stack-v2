// Adversarial checks for 20270187000000_macro_planner_adapt.sql (disruptions, B/C races, availability, reviews, audit, sharing).
// Run with harness.mjs after the base macro planner migration, see README.
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
async function as(c, user, sql, params = [], { commit = false } = {}) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
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
const monday = (offsetWeeks) => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + offsetWeeks * 7)
  return d.toISOString().slice(0, 10)
}
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)

export async function run(c) {
  for (const n of ['admin', 'rider', 'rider2', 'coach', 'coach2', 'stranger', 'ended']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  const rel = (coach, rider, status, extra = '') => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by,responded_at,ended_at) VALUES ($1,$2,$3,$1,now(),${extra || 'NULL'})`, [coach, rider, status])
  await rel(U.coach, U.rider, 'active'); await rel(U.coach2, U.rider2, 'active')
  await rel(U.ended, U.rider, 'ended', `now() - interval '5 days'`)
  await c.query(`INSERT INTO macro_planner_allowlist(user_id) VALUES ($1), ($2), ($3), ($4), ($5) ON CONFLICT DO NOTHING`, [U.coach, U.coach2, U.stranger, U.ended, U.rider])

  const race = day(70)
  const week = (i, over = {}) => ({ week_start: monday(i), kind: 'build', target_tl: 300 + i * 10, focus: 'Base', note: 'n', day_shape: 'RHEHEHE', tl_overridden: false, ...over })
  const plan = (rider, over = {}) => ({
    rider_id: rider, race_name: 'Nationals', race_date: race, race_length: 'medium', template: '3+1', build_weeks: 3, recovery_weeks: 1,
    ramp_ceiling_pct: 7, start_weekly_tl: 300, baseline_source: 'history', goal_ctl: 80, weeks: [week(0), week(1), week(2, { kind: 'recovery' })], ...over,
  })
  const call = (u, sql, params = [], commit = true) => as(c, u, sql, params, { commit })
  const save = (u, p) => call(u, `SELECT macro_plan_save($1::jsonb) AS id`, [JSON.stringify(p)])
  const get = (u, rider) => as(c, u, `SELECT macro_plan_get($1) AS p`, [rider])
  const mine = (u) => as(c, u, `SELECT my_macro_plan() AS p`)
  const planId = (await save(U.coach, plan(U.rider))).rows[0].id
  const planId2 = (await save(U.coach2, plan(U.rider2))).rows[0].id
  await call(U.coach, `SELECT macro_plan_publish($1, true)`, [planId])
  const dis = (over = {}) => JSON.stringify({ kind: 'illness', severity: 'moderate', start_date: day(-3), end_date: day(2), note: 'flu', ...over })
  const saveDis = (u, plan_id, over) => call(u, `SELECT macro_plan_disruption_save($1, $2::jsonb) AS id`, [plan_id, dis(over)])

  // Access: every new RPC refuses strangers, other coaches, athletes, ended coaches, anon and the flag-off case
  const rpcs = (id) => [
    [`SELECT macro_plan_disruption_save($1, $2::jsonb)`, [id, dis()]],
    [`SELECT macro_plan_races_set($1, '[]'::jsonb)`, [id]],
    [`SELECT macro_plan_availability_set($1, '[]'::jsonb)`, [id]],
    [`SELECT macro_plan_review_set($1, $2::date, 'x', 'open')`, [id, monday(0)]],
    [`SELECT macro_plan_share_set($1, true, 'why')`, [id]],
    [`SELECT macro_plan_apply($1, $2::jsonb)`, [id, JSON.stringify({ source: 'manual', option: 'x', summary: 'x', weeks: [week(0)] })]],
  ]
  for (const [who, label] of [[U.stranger, 'stranger'], [U.coach2, 'other coach'], [U.rider, 'athlete'], [U.ended, 'ended coach']]) {
    let all = true
    for (const [sql, params] of rpcs(planId)) all = all && !(await call(who, sql, params, false)).ok
    ok(`${label} cannot call any plan-adapt RPC on someone else's plan`, all)
  }
  let anon = true
  for (const [sql, params] of rpcs(planId)) anon = anon && !(await as(c, null, sql, params)).ok
  ok('anon cannot call any plan-adapt RPC', anon)
  ok('client cannot touch the new tables', (await Promise.all(['macro_plan_disruptions', 'macro_plan_races', 'macro_plan_availability', 'macro_plan_audit', 'macro_plan_reviews']
    .map(async (t) => (await as(c, U.coach, `SELECT * FROM ${t}`)).ok || (await as(c, U.coach, `DELETE FROM ${t}`)).ok))).every((x) => !x))
  ok('self-coaching is impossible', !(await save(U.coach, plan(U.coach))).ok)
  ok('the athlete is not coach of a plan about themselves', !(await call(U.rider, `SELECT macro_plan_disruption_save($1, $2::jsonb)`, [planId, dis()], false)).ok)

  // Disruptions
  const d1 = await saveDis(U.coach, planId)
  ok('coach logs a disruption', d1.ok)
  ok('coach reads it back via macro_plan_get', (await get(U.coach, U.rider)).rows[0].p.disruptions.length === 1)
  ok('open-ended disruption is allowed', (await saveDis(U.coach, planId, { end_date: null })).ok)
  const bad = async (name, over) => ok(`rejects disruption with ${name}`, !(await saveDis(U.coach, planId, over)).ok)
  await bad('end before start', { end_date: day(-10) })
  await bad('unknown kind', { kind: 'cold' })
  await bad('unknown severity', { severity: 'huge' })
  await bad('long note', { note: 'x'.repeat(301) })
  await bad('garbage date', { start_date: 'soon' })
  await bad('a break over a year', { start_date: day(-400), end_date: day(0) })
  ok('coach edits a disruption (end date set)', (await call(U.coach, `SELECT macro_plan_disruption_save($1, $2::jsonb)`, [planId, JSON.stringify({ id: d1.rows[0].id, kind: 'injury', severity: 'severe', start_date: day(-3), end_date: day(10) })])).ok
    && (await get(U.coach, U.rider)).rows[0].p.disruptions.some((d) => d.id === d1.rows[0].id && d.kind === 'injury'))
  ok('cannot edit a disruption through another plan', !(await call(U.coach2, `SELECT macro_plan_disruption_save($1, $2::jsonb)`, [planId2, JSON.stringify({ id: d1.rows[0].id, kind: 'injury', severity: 'mild', start_date: day(-3) })], false)).ok)
  ok('cannot delete a disruption through another plan', !(await call(U.coach2, `SELECT macro_plan_disruption_delete($1, $2)`, [planId2, d1.rows[0].id])).ok)
  for (let i = 0; i < 28; i++) await saveDis(U.coach, planId, { start_date: day(-20 - i), end_date: day(-19 - i) })
  ok('at most 30 disruptions per plan', !(await saveDis(U.coach, planId)).ok)
  ok('coach deletes a disruption', (await call(U.coach, `SELECT macro_plan_disruption_delete($1, $2)`, [planId, d1.rows[0].id])).ok
    && !(await call(U.coach, `SELECT macro_plan_disruption_delete($1, $2)`, [planId, d1.rows[0].id])).ok)
  await c.query(`DELETE FROM macro_plan_disruptions WHERE plan_id = $1 AND start_date < $2`, [planId, day(-5)])

  // Health data never reaches the athlete
  const m = await mine(U.rider)
  ok('athlete payload has no disruptions, availability, reviews or audit', m.ok && !['disruptions', 'availability', 'reviews', 'audit'].some((k) => k in m.rows[0].p)
    && !JSON.stringify(m.rows[0].p).includes('flu'))

  // B/C races
  const races = (list) => call(U.coach, `SELECT macro_plan_races_set($1, $2::jsonb)`, [planId, JSON.stringify(list)])
  ok('coach sets B/C races', (await races([{ name: 'Club TT', race_date: day(20), priority: 'B' }, { name: 'Crit', race_date: day(30), priority: 'C' }])).ok
    && (await get(U.coach, U.rider)).rows[0].p.races.length === 2)
  ok('athlete sees the races', (await mine(U.rider)).rows[0].p.races.length === 2)
  ok('rejects a race after the A race', !(await races([{ name: 'Late', race_date: day(80), priority: 'B' }])).ok)
  ok('rejects a race on the A race day', !(await races([{ name: 'Same', race_date: race, priority: 'C' }])).ok)
  ok('rejects priority A', !(await races([{ name: 'X', race_date: day(10), priority: 'A' }])).ok)
  ok('rejects empty name', !(await races([{ name: ' ', race_date: day(10), priority: 'B' }])).ok)
  ok('rejects over 20 races', !(await races(Array.from({ length: 21 }, (_, i) => ({ name: 'r' + i, race_date: day(5 + i), priority: 'C' })))).ok)
  ok('rejects a non-list', !(await call(U.coach, `SELECT macro_plan_races_set($1, '{}'::jsonb)`, [planId])).ok)
  ok('a failed replace keeps the old races', (await get(U.coach, U.rider)).rows[0].p.races.length === 2)

  // Availability
  const avail = (list) => call(U.coach, `SELECT macro_plan_availability_set($1, $2::jsonb)`, [planId, JSON.stringify(list)])
  ok('coach sets reduced-availability weeks', (await avail([{ week_start: monday(1), availability_pct: 60, reason: 'travel', note: 'Spain' }])).ok
    && (await get(U.coach, U.rider)).rows[0].p.availability[0].availability_pct === 60)
  ok('rejects pct over 100', !(await avail([{ week_start: monday(1), availability_pct: 120, reason: 'work' }])).ok)
  ok('rejects a non-Monday', !(await avail([{ week_start: day(0) === monday(0) ? day(1) : day(0), availability_pct: 50, reason: 'work' }])).ok)
  ok('rejects an unknown reason', !(await avail([{ week_start: monday(1), availability_pct: 50, reason: 'party' }])).ok)
  ok('rejects duplicate weeks', !(await avail([{ week_start: monday(1), availability_pct: 50, reason: 'work' }, { week_start: monday(1), availability_pct: 40, reason: 'work' }])).ok)
  ok('failed replace keeps old availability', (await get(U.coach, U.rider)).rows[0].p.availability.length === 1)

  // Reviews
  const review = (st, w = monday(-1)) => call(U.coach, `SELECT macro_plan_review_set($1, $2::date, 'Two red weeks', $3)`, [planId, w, st])
  ok('coach opens a review', (await review('open')).ok && (await get(U.coach, U.rider)).rows[0].p.reviews[0].status === 'open')
  ok('coach dismisses it; re-proposing does not reopen unless asked', (await review('dismissed')).ok && (await get(U.coach, U.rider)).rows[0].p.reviews[0].status === 'dismissed')
  ok('rejects a bad status', !(await review('maybe')).ok)
  ok('rejects a non-Monday week', !(await review('open', day(0) === monday(0) ? day(1) : day(0))).ok)

  // Sharing the reasoning (default off, athlete only sees it when shared)
  await call(U.coach, `SELECT macro_plan_save($1::jsonb)`, [JSON.stringify(plan(U.rider, { weeks: [week(0, { rationale: 'Aerobic base first' }), week(1), week(2, { kind: 'recovery' })] }))])
  const hidden = (await mine(U.rider)).rows[0].p
  ok('sharing is off by default and the rationale is hidden', hidden.share_reasoning === false && !JSON.stringify(hidden).includes('Aerobic') && !hidden.weeks.some((w) => 'rationale' in w) && !('plan_rationale' in hidden))
  ok('coach sees the rationale', (await get(U.coach, U.rider)).rows[0].p.weeks[0].rationale === 'Aerobic base first')
  ok('saving without a rationale keeps the stored one', (await save(U.coach, plan(U.rider))).ok && (await get(U.coach, U.rider)).rows[0].p.weeks[0].rationale === 'Aerobic base first')
  ok('rejects a too long rationale', !(await call(U.coach, `SELECT macro_plan_share_set($1, true, $2)`, [planId, 'x'.repeat(1001)])).ok
    && !(await save(U.coach, plan(U.rider, { weeks: [week(0, { rationale: 'x'.repeat(501) })] }))).ok)
  ok('coach turns sharing on', (await call(U.coach, `SELECT macro_plan_share_set($1, true, 'Peak in week 8')`, [planId])).ok)
  const shared = (await mine(U.rider)).rows[0].p
  ok('athlete now sees the plan and week rationale', shared.plan_rationale === 'Peak in week 8' && shared.weeks[0].rationale === 'Aerobic base first' && shared.weeks.length === 3)
  ok('shared weeks stay sorted', shared.weeks.map((w) => w.week_start).join() === [monday(0), monday(1), monday(2)].join())
  ok('sharing off again hides it', (await call(U.coach, `SELECT macro_plan_share_set($1, false, 'Peak in week 8')`, [planId])).ok
    && !JSON.stringify((await mine(U.rider)).rows[0].p).includes('Aerobic'))

  // Apply a suggestion + audit trail
  const apply = (u, id, over = {}, commit = true) => call(u, `SELECT macro_plan_apply($1, $2::jsonb) AS id`, [id, JSON.stringify({ source: 'disruption', option: 'shift', summary: 'Shift forward after flu', weeks: [week(0, { target_tl: 100 }), week(1, { target_tl: 150 })], goal_ctl: 70, ...over })], commit)
  const a = await apply(U.coach, planId)
  ok('coach applies an option', a.ok)
  const after = (await get(U.coach, U.rider)).rows[0].p
  ok('apply replaces weeks, goal and keeps rationale', after.weeks.length === 2 && after.weeks[0].target_tl === 100 && Number(after.goal_ctl) === 70 && after.weeks[0].rationale === 'Aerobic base first')
  ok('apply wrote one audit row with before and after', after.audit.length === 1 && after.audit[0].summary === 'Shift forward after flu' && after.audit[0].actor_id === U.coach)
  const det = (await c.query(`SELECT details FROM macro_plan_audit WHERE id = $1`, [a.rows[0].id])).rows[0].details
  ok('audit details hold before, after and goal change', det.before.length === 3 && det.after.length === 2 && Number(det.goal_before) === 80 && Number(det.goal_after) === 70)
  ok('goal_ctl omitted keeps the goal', (await apply(U.coach, planId, { goal_ctl: undefined })).ok && Number((await get(U.coach, U.rider)).rows[0].p.goal_ctl) === 70)
  ok('goal_ctl null clears the goal', (await apply(U.coach, planId, { goal_ctl: null })).ok && (await get(U.coach, U.rider)).rows[0].p.goal_ctl === null)
  const before = (await get(U.coach, U.rider)).rows[0].p
  const badApply = async (name, over) => ok(`apply rejects ${name} and changes nothing`, !(await apply(U.coach, planId, over)).ok
    && JSON.stringify((await get(U.coach, U.rider)).rows[0].p.weeks) === JSON.stringify(before.weeks) && (await get(U.coach, U.rider)).rows[0].p.audit.length === before.audit.length)
  await badApply('an unknown source', { source: 'magic' })
  await badApply('an empty summary', { summary: ' ' })
  await badApply('an empty option', { option: '' })
  await badApply('empty weeks', { weeks: [] })
  await badApply('a duplicate week', { weeks: [week(0), week(0)] })
  await badApply('a week after the race', { weeks: [week(0), week(40)] })
  await badApply('a negative target', { weeks: [week(0, { target_tl: -1 })] })
  ok('audit is append-only for clients', !(await call(U.coach, `UPDATE macro_plan_audit SET summary = 'x'`, [], false)).ok && !(await call(U.coach, `DELETE FROM macro_plan_audit`, [], false)).ok)
  ok('athlete never sees the audit trail', !JSON.stringify((await mine(U.rider)).rows[0].p).includes('Shift forward'))

  // Flag off / revocation
  await c.query(`DELETE FROM macro_planner_allowlist WHERE user_id = $1`, [U.coach])
  let off = true
  for (const [sql, params] of rpcs(planId)) off = off && !(await call(U.coach, sql, params, false)).ok
  ok('with the flag off every new RPC refuses', off && (await mine(U.rider)).rows[0].p === null)
  await c.query(`INSERT INTO macro_planner_allowlist(user_id) VALUES ($1)`, [U.coach])
  await c.query(`UPDATE coaching_relationships SET status = 'ended', ended_at = now() WHERE coach_id = $1 AND rider_id = $2`, [U.coach, U.rider])
  let ended = true
  for (const [sql, params] of rpcs(planId)) ended = ended && !(await call(U.coach, sql, params, false)).ok
  ok('ended relationship: new RPCs refuse immediately', ended && !(await get(U.coach, U.rider)).ok)
  await c.query(`UPDATE coaching_relationships SET status = 'active', ended_at = NULL WHERE coach_id = $1 AND rider_id = $2`, [U.coach, U.rider])

  // Cascade
  ok('deleting the plan removes every dependent row', (await call(U.coach, `SELECT macro_plan_delete($1)`, [planId])).ok
    && (await Promise.all(['macro_plan_disruptions', 'macro_plan_races', 'macro_plan_availability', 'macro_plan_audit', 'macro_plan_reviews']
      .map(async (t) => (await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE plan_id = $1`, [planId])).rows[0].n))).every((n) => n === 0))
}
