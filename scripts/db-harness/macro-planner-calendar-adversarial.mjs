// Adversarial checks for 20270188000000_macro_planner_calendar_races.sql (planner races come from the athlete's calendar).
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
  for (const n of ['rider', 'rider2', 'coach', 'coach2', 'stranger']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  const rel = (coach, rider) => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by,responded_at) VALUES ($1,$2,'active',$1,now())`, [coach, rider])
  await rel(U.coach, U.rider); await rel(U.coach2, U.rider2)
  await c.query(`INSERT INTO macro_planner_allowlist(user_id) VALUES ($1), ($2), ($3) ON CONFLICT DO NOTHING`, [U.coach, U.coach2, U.stranger])

  const call = (u, sql, params = [], commit = true) => as(c, u, sql, params, { commit })
  const addRace = async (u, rider, name, date, priority = 'A') =>
    (await call(u, `INSERT INTO calendar_races(rider_id, race_date, name, priority) VALUES ($1, $2, $3, $4) RETURNING id`, [rider, date, name, priority])).rows?.[0]?.id
  const cal = async (id) => (await c.query(`SELECT * FROM calendar_races WHERE id = $1`, [id])).rows[0]
  const planRow = async (id) => (await c.query(`SELECT *, race_date::text AS rd FROM macro_plans WHERE id = $1`, [id])).rows[0]

  const raceDate = day(70)
  const raceWeek = monday(0, new Date(raceDate))
  const rA = await addRace(U.coach, U.rider, 'Nationals', raceDate)
  const rB = await addRace(U.rider, U.rider, 'Club race', day(30), 'B')
  const rC = await addRace(U.rider, U.rider, 'Local crit', day(40), 'C')
  const rOther = await addRace(U.coach2, U.rider2, 'Other rider race', day(60))
  ok('coach can add a race on the athlete calendar (existing permission)', !!rA && !!rB && !!rOther)
  ok('stranger cannot add a race on the athlete calendar', !(await addRace(U.stranger, U.rider, 'x', day(20))))

  const week = (i, over = {}) => ({ week_start: monday(i), kind: 'build', target_tl: 300 + i * 10, focus: 'Base', note: 'n', day_shape: 'RHEHEHE', tl_overridden: false, ...over })
  const weeksTo = (last) => { const out = []; for (let i = 0; monday(i) <= last; i++) out.push(week(i)); return out }
  const plan = (rider, race_id, over = {}) => ({
    rider_id: rider, race_id, race_length: 'medium', template: '3+1', build_weeks: 3, recovery_weeks: 1,
    ramp_ceiling_pct: 7, start_weekly_tl: 300, baseline_source: 'history', goal_ctl: 80, weeks: weeksTo(raceWeek), ...over,
  })
  const save = (u, p) => call(u, `SELECT macro_plan_save($1::jsonb) AS id`, [JSON.stringify(p)])

  // Save refuses free-form, foreign and unknown races
  ok('save without race_id refused', !(await save(U.coach, plan(U.rider, undefined, { race_name: 'Free', race_date: raceDate }))).ok)
  ok('save with another rider\'s calendar race refused', !(await save(U.coach, plan(U.rider, rOther))).ok)
  ok('save with unknown race refused', !(await save(U.coach, plan(U.rider, uid()))).ok)
  ok('save with garbage race_id refused', !(await save(U.coach, plan(U.rider, 'nope'))).ok)
  ok('stranger cannot save for the rider', !(await save(U.stranger, plan(U.rider, rA))).ok)
  ok('athlete cannot save', !(await save(U.rider, plan(U.rider, rA))).ok)

  const s = await save(U.coach, plan(U.rider, rA, { race_name: 'Spoofed', race_date: day(5) }))
  ok('coach saves with a calendar race', s.ok)
  const id = s.rows[0].id
  let p = await planRow(id)
  ok('name and date come from the calendar, payload ignored', p.race_name === 'Nationals' && p.rd === raceDate && p.race_id === rA && p.attention === null)

  // B/C races
  const set = (u, arr) => call(u, `SELECT macro_plan_races_set($1, $2::jsonb)`, [id, JSON.stringify(arr)])
  ok('free-form B/C entry refused', !(await set(U.coach, [{ name: 'Free', race_date: day(20), priority: 'B' }])).ok)
  ok('A race cannot be a B/C race', !(await set(U.coach, [{ race_id: rA, priority: 'B' }])).ok)
  ok('other rider\'s race refused as B/C', !(await set(U.coach, [{ race_id: rOther, priority: 'B' }])).ok)
  ok('stranger cannot set B/C', !(await set(U.stranger, [{ race_id: rB, priority: 'B' }])).ok)
  ok('B/C from the calendar accepted', (await set(U.coach, [{ race_id: rB, priority: 'B' }, { race_id: rC, priority: 'C' }])).ok)
  ok('same race twice refused', !(await set(U.coach, [{ race_id: rB, priority: 'B' }, { race_id: rB, priority: 'C' }])).ok)
  ok('a B/C race cannot also be the A race on save', !(await save(U.coach, plan(U.rider, rB))).ok)
  const rowsOf = async () => (await c.query(`SELECT race_id, name, missing, priority FROM macro_plan_races WHERE plan_id = $1 ORDER BY race_date`, [id])).rows
  ok('B/C rows carry calendar name', (await rowsOf()).map((r) => r.name).join() === 'Club race,Local crit')

  // Calendar follows: rename
  await call(U.rider, `UPDATE calendar_races SET name = 'Club champs' WHERE id = $1`, [rB])
  ok('rename in calendar updates B race', (await rowsOf()).some((r) => r.name === 'Club champs'))
  await call(U.coach, `UPDATE calendar_races SET name = 'National champs' WHERE id = $1`, [rA])
  p = await planRow(id)
  ok('rename in calendar updates A race, no attention', p.race_name === 'National champs' && p.attention === null)

  // Move
  await call(U.coach, `UPDATE calendar_races SET race_date = $2 WHERE id = $1`, [rA, day(84)])
  p = await planRow(id)
  ok('moving the A race syncs the date and flags the plan', p.attention === 'race_moved' && p.rd === day(84))
  ok('ack refused for stranger', !(await call(U.stranger, `SELECT macro_plan_attention_ack($1)`, [id])).ok)
  ok('ack refused for athlete', !(await call(U.rider, `SELECT macro_plan_attention_ack($1)`, [id])).ok)
  ok('coach acks', (await call(U.coach, `SELECT macro_plan_attention_ack($1)`, [id])).ok)
  ok('attention cleared after ack', (await planRow(id)).attention === null)

  // Moving a B race flags the plan too
  await call(U.rider, `UPDATE calendar_races SET race_date = $2 WHERE id = $1`, [rC, day(41)])
  ok('moving a B/C race flags the plan', (await planRow(id)).attention === 'race_moved')
  await call(U.coach, `SELECT macro_plan_attention_ack($1)`, [id])

  // Athlete view hides attention and ids
  await call(U.coach, `SELECT macro_plan_publish($1, true)`, [id])
  await call(U.rider, `UPDATE calendar_races SET race_date = $2 WHERE id = $1`, [rB, day(31)])
  const mine = (await as(c, U.rider, `SELECT my_macro_plan() AS p`)).rows[0].p
  ok('athlete JSON has no attention / race ids', mine && !('attention' in mine) && !('race_id' in mine) && mine.races.every((r) => !('race_id' in r) && !('missing' in r)))
  ok('coach JSON exposes attention', (await as(c, U.coach, `SELECT macro_plan_get($1) AS p`, [U.rider])).rows[0].p.attention === 'race_moved')
  await call(U.coach, `SELECT macro_plan_attention_ack($1)`, [id])

  // Delete a B race: plan kept, race marked missing, athlete does not see it, coach sees warning
  await call(U.rider, `DELETE FROM calendar_races WHERE id = $1`, [rB])
  let rows = await rowsOf()
  ok('deleting a linked B race keeps the row, marked missing', rows.length === 2 && rows.some((r) => r.missing && r.race_id === null))
  const g = (await as(c, U.coach, `SELECT macro_plan_get($1) AS p`, [U.rider])).rows[0].p
  ok('coach JSON warns about the missing B/C race', g.attention === 'minor_race_deleted')
  const mine2 = (await as(c, U.rider, `SELECT my_macro_plan() AS p`)).rows[0].p
  ok('athlete does not see the missing race', mine2.races.length === 1)
  ok('ack does not clear a missing B/C race flag', (await call(U.coach, `SELECT macro_plan_attention_ack($1)`, [id])).ok && (await as(c, U.coach, `SELECT macro_plan_get($1) AS p`, [U.rider])).rows[0].p.attention === 'minor_race_deleted')
  ok('replacing the B/C set clears missing rows', (await set(U.coach, [{ race_id: rC, priority: 'C' }])).ok && (await rowsOf()).every((r) => !r.missing))

  // Delete the A race: plan kept, flagged, unlinked
  await call(U.coach, `DELETE FROM calendar_races WHERE id = $1`, [rA])
  p = await planRow(id)
  ok('deleting the A race keeps the plan and flags it', p && p.attention === 'race_deleted' && p.race_id === null && p.race_name === 'National champs')
  ok('ack cannot clear a deleted A race', (await call(U.coach, `SELECT macro_plan_attention_ack($1)`, [id])).ok && (await planRow(id)).attention === 'race_deleted')
  const rNew = await addRace(U.coach, U.rider, 'Replacement A', raceDate)
  ok('save without race_id refused while unlinked', !(await save(U.coach, plan(U.rider, undefined))).ok)
  ok('coach relinks to another calendar race', (await save(U.coach, plan(U.rider, rNew))).ok)
  p = await planRow(id)
  ok('relink with weeks to the race week clears attention', p.race_id === rNew && p.race_name === 'Replacement A' && p.attention === null)

  // Past-dated new plan refused; calendar unaffected for riders with no plan
  const rPast = await addRace(U.coach2, U.rider2, 'Old race', day(-30))
  ok('new plan on a past race refused', !(await save(U.coach2, plan(U.rider2, rPast, { weeks: [week(-6)] }))).ok)
  ok('calendar edit works without any plan', (await call(U.coach2, `UPDATE calendar_races SET name = 'Renamed', race_date = $2 WHERE id = $1`, [rOther, day(61)])).ok)
  ok('calendar delete works without any plan', (await call(U.coach2, `DELETE FROM calendar_races WHERE id = $1`, [rOther])).ok)
  ok('clients still have no table access', !(await as(c, U.coach, `SELECT * FROM macro_plan_races`)).ok)
  ok('anon cannot call ack', !(await call(null, `SELECT macro_plan_attention_ack($1)`, [id])).ok)

  // Flag off for the coach: refused server-side
  await c.query(`DELETE FROM macro_planner_allowlist WHERE user_id = $1`, [U.coach])
  ok('flag off: save refused', !(await save(U.coach, plan(U.rider, rNew))).ok)
  ok('flag off: races_set refused', !(await set(U.coach, [])).ok)
  ok('flag off: ack refused', !(await call(U.coach, `SELECT macro_plan_attention_ack($1)`, [id])).ok)
  ok('flag off: calendar still editable', (await call(U.coach, `UPDATE calendar_races SET notes = 'x' WHERE id = $1`, [rNew])).ok)
}
