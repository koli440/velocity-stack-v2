// Adversarial checks for 20270189000000_macro_planner_calendar_guidance.sql (plan guidance in the athlete's calendar).
// Run with harness.mjs after all migrations, see README.
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
const monday = (offsetWeeks, from = new Date()) => {
  const d = new Date(from)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + offsetWeeks * 7)
  return d.toISOString().slice(0, 10)
}
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)

export async function run(c) {
  for (const n of ['rider', 'rider2', 'coach', 'coach2', 'stranger', 'ended']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  const rel = (coach, rider, status, extra = 'NULL') => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by,responded_at,ended_at) VALUES ($1,$2,$3,$1,now(),${extra})`, [coach, rider, status])
  await rel(U.coach, U.rider, 'active'); await rel(U.coach2, U.rider2, 'active')
  await rel(U.ended, U.rider, 'ended', `now() - interval '5 days'`)
  await c.query(`INSERT INTO macro_planner_allowlist(user_id) VALUES ($1), ($2), ($3), ($4) ON CONFLICT DO NOTHING`, [U.coach, U.coach2, U.stranger, U.ended])

  const call = (u, sql, params = []) => as(c, u, sql, params, { commit: true })
  const raceDate = day(70)
  const raceWeek = monday(0, new Date(raceDate))
  const rA = (await call(U.coach, `INSERT INTO calendar_races(rider_id, race_date, name, priority) VALUES ($1,$2,'Nationals','A') RETURNING id`, [U.rider, raceDate])).rows[0].id
  const rB = (await call(U.coach, `INSERT INTO calendar_races(rider_id, race_date, name, priority) VALUES ($1,$2,'Club','B') RETURNING id`, [U.rider, day(30)])).rows[0].id
  const weeks = []
  for (let i = 0; monday(i) <= raceWeek; i++) weeks.push({ week_start: monday(i), kind: 'build', target_tl: 300 + i, focus: 'Base', note: 'n', day_shape: 'RHEHEHE', tl_overridden: false, rationale: 'secret why' })
  const save = (u, p) => call(u, `SELECT macro_plan_save($1::jsonb) AS id`, [JSON.stringify(p)])
  const id = (await save(U.coach, { rider_id: U.rider, race_id: rA, race_length: 'medium', template: '3+1', build_weeks: 3, recovery_weeks: 1, ramp_ceiling_pct: 7, start_weekly_tl: 300, baseline_source: 'history', weeks })).rows[0].id
  await call(U.coach, `SELECT macro_plan_races_set($1, $2::jsonb)`, [id, JSON.stringify([{ race_id: rB, priority: 'B' }])])
  const cal = (u, rider) => as(c, u, `SELECT macro_plan_calendar($1) AS p`, [rider])
  const getP = async (u, rider) => (await cal(u, rider)).rows?.[0]?.p ?? null

  // Coach
  const g = await getP(U.coach, U.rider)
  ok('coach gets the plan guidance', g && g.viewer === 'coach' && g.weeks.length === weeks.length && g.races.length === 1 && g.share_calendar === false)
  ok('coach sees day shape, focus and rationale', g.weeks[0].day_shape === 'RHEHEHE' && g.weeks[0].rationale === 'secret why')

  // Athlete: nothing by default, also when published
  ok('athlete gets nothing while the plan is a draft and not shared', (await getP(U.rider, U.rider)) === null)
  await call(U.coach, `SELECT macro_plan_publish($1, true)`, [id])
  ok('athlete gets nothing when published but calendar not shared', (await getP(U.rider, U.rider)) === null)

  // Others
  ok('stranger coach gets nothing', (await getP(U.stranger, U.rider)) === null)
  ok('other coach gets nothing', (await getP(U.coach2, U.rider)) === null)
  ok('ended coach gets nothing', (await getP(U.ended, U.rider)) === null)
  ok('other athlete gets nothing for this rider', (await getP(U.rider2, U.rider)) === null)
  ok('anon cannot call', !(await call(null, `SELECT macro_plan_calendar($1)`, [U.rider])).ok)

  // Share permissions
  const share = (u, v) => call(u, `SELECT macro_plan_calendar_share_set($1, $2)`, [id, v])
  ok('athlete cannot share', !(await share(U.rider, true)).ok)
  ok('stranger cannot share', !(await share(U.stranger, true)).ok)
  ok('ended coach cannot share', !(await share(U.ended, true)).ok)
  ok('anon cannot share', !(await share(null, true)).ok)
  ok('coach shares', (await share(U.coach, true)).ok)

  const a = await getP(U.rider, U.rider)
  ok('athlete sees shared guidance', a && a.viewer === 'athlete' && a.weeks.length === weeks.length)
  ok('athlete JSON has no attention, ids, flags, rationale', !('attention' in a) && !('race_id' in a) && !('share_reasoning' in a) && !('share_calendar' in a) && !('coach_id' in a)
    && !('plan_rationale' in a) && a.weeks.every((w) => !('rationale' in w)) && a.races.every((r) => !('race_id' in r) && !('missing' in r)))

  // Approved changes only: disruptions/availability/reviews are never plan content
  await call(U.coach, `SELECT macro_plan_disruption_save($1, $2::jsonb)`, [id, JSON.stringify({ kind: 'illness', severity: 'severe', start_date: day(-3), end_date: day(10), note: 'flu' })])
  const g2 = await getP(U.coach, U.rider)
  ok('a logged disruption does not change the planned weeks', JSON.stringify(g2.weeks) === JSON.stringify(g.weeks) && !('disruptions' in g2))
  ok('athlete JSON has no disruption', !JSON.stringify(await getP(U.rider, U.rider)).includes('flu'))
  const w2 = weeks.map((w, i) => (i === 0 ? { ...w, target_tl: 111 } : w))
  ok('coach applies an option', (await call(U.coach, `SELECT macro_plan_apply($1, $2::jsonb)`, [id, JSON.stringify({ source: 'disruption', option: 'shift', summary: 'x', weeks: w2 })])).ok)
  ok('applied weeks are reflected for coach and shared athlete', (await getP(U.coach, U.rider)).weeks[0].target_tl == 111 && (await getP(U.rider, U.rider)).weeks[0].target_tl == 111)

  // Reasoning sharing is separate
  await call(U.coach, `SELECT macro_plan_share_set($1, true, 'why')`, [id])
  const r1 = await getP(U.rider, U.rider)
  ok('rationale shows only with share_reasoning', r1.plan_rationale === 'why' && r1.weeks[0].rationale !== undefined)

  // Missing B/C race hidden from athlete
  await call(U.coach, `DELETE FROM calendar_races WHERE id = $1`, [rB])
  ok('deleted B race hidden from athlete, still listed for coach', (await getP(U.rider, U.rider)).races.length === 0 && (await getP(U.coach, U.rider)).races.length === 1)

  // Unpublish / flag off / relationship ended
  await call(U.coach, `SELECT macro_plan_publish($1, false)`, [id])
  ok('unpublished plan: athlete gets nothing, coach still sees it', (await getP(U.rider, U.rider)) === null && (await getP(U.coach, U.rider)) !== null)
  await call(U.coach, `SELECT macro_plan_publish($1, true)`, [id])
  ok('republished: athlete sees it again', (await getP(U.rider, U.rider)) !== null)
  await c.query(`DELETE FROM macro_planner_allowlist WHERE user_id = $1`, [U.coach])
  ok('flag off: nobody gets guidance, share refused', (await getP(U.rider, U.rider)) === null && (await getP(U.coach, U.rider)) === null && !(await share(U.coach, false)).ok)
  await c.query(`INSERT INTO macro_planner_allowlist(user_id) VALUES ($1)`, [U.coach])
  await c.query(`UPDATE coaching_relationships SET status = 'ended', ended_at = now() WHERE coach_id = $1 AND rider_id = $2`, [U.coach, U.rider])
  ok('ended relationship: nobody gets guidance', (await getP(U.rider, U.rider)) === null && (await getP(U.coach, U.rider)) === null)
  ok('no plan: nothing', (await getP(U.coach2, U.rider2)) === null && (await getP(U.rider2, U.rider2)) === null)
}
