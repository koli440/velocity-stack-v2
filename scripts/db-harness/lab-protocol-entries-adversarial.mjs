// Adversarial checks for 20270178000000_lab_protocol_entries.sql (fueling, bike fit, pedalling, cadence). Run with harness.mjs, see README.
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

export async function run(c) {
  for (const n of ['coach', 'rider', 'other', 'stranger']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by,responded_at) VALUES ($1,$2,'active',$1,now())`, [U.coach, U.rider])
  const save = (u, a, kind, data) => as(c, u, `SELECT lab_entry_save($1,$2,'2026-11-16',$3::jsonb)`, [a, kind, JSON.stringify(data)], { commit: true })
  const list = (u, a, kind = null) => as(c, u, `SELECT * FROM lab_entry_list($1,$2)`, [a, kind])
  const fuel = { session: 'fed', duration_min: 90, carbs_g_per_h: 60, readings: [{ t: -10, mmol: 5 }, { t: 30, mmol: 6 }] }

  ok('no direct table privileges', !(await as(c, U.rider, `SELECT * FROM lab_protocol_entries`)).ok)
  ok('anon refused', !(await as(c, null, `SELECT * FROM lab_entry_list($1,null)`, [U.rider])).ok)
  ok('stranger cannot save or read', !(await save(U.stranger, U.rider, 'fit', { comfort: 3 })).ok && !(await list(U.stranger, U.rider)).ok)
  ok('unknown kind', !(await save(U.rider, U.rider, 'body', { comfort: 3 })).ok)
  ok('fueling needs session, 2 readings, ranges', !(await save(U.rider, U.rider, 'fueling', { ...fuel, session: 'x' })).ok
    && !(await save(U.rider, U.rider, 'fueling', { ...fuel, readings: [fuel.readings[0]] })).ok
    && !(await save(U.rider, U.rider, 'fueling', { ...fuel, readings: [{ t: 0, mmol: 99 }, { t: 5, mmol: 5 }] })).ok
    && !(await save(U.rider, U.rider, 'fueling', { ...fuel, evil: 1 })).ok)
  ok('fueling oversized rejected', !(await save(U.rider, U.rider, 'fueling', { ...fuel, readings: Array.from({ length: 81 }, (_, i) => ({ t: i, mmol: 5 })) })).ok)
  ok('fit range and empty', !(await save(U.rider, U.rider, 'fit', { saddle_height_mm: 5000 })).ok && !(await save(U.rider, U.rider, 'fit', {})).ok)
  ok('pedalling needs a metric', !(await save(U.rider, U.rider, 'pedalling', { avg_power_w: 200 })).ok)
  ok('cadence needs 2 valid steps', !(await save(U.rider, U.rider, 'cadence', { steps: [{ rpm: 80, power_w: 200 }] })).ok
    && !(await save(U.rider, U.rider, 'cadence', { steps: [{ rpm: 80, power_w: 200 }, { rpm: 90 }] })).ok)
  ok('rider saves all kinds', (await save(U.rider, U.rider, 'fueling', fuel)).ok
    && (await save(U.rider, U.rider, 'fit', { saddle_height_mm: 740, comfort: 4 })).ok
    && (await save(U.rider, U.rider, 'pedalling', { left_balance_pct: 49 })).ok
    && (await save(U.rider, U.rider, 'cadence', { steps: [{ rpm: 80, power_w: 200 }, { rpm: 90, power_w: 210, hr: 150 }] })).ok)
  ok('list filters by kind', (await list(U.rider, U.rider, 'fit')).rows.length === 1 && (await list(U.rider, U.rider)).rows.length === 4)
  ok('active coach reads glucose', (await list(U.coach, U.rider, 'fueling')).rows.length === 1)
  ok('other rider cannot read or save for rider', !(await list(U.other, U.rider)).ok && !(await save(U.other, U.rider, 'fit', { comfort: 3 })).ok)
  const id = (await list(U.rider, U.rider, 'fit')).rows[0].id
  ok('stranger cannot delete', !(await as(c, U.stranger, `SELECT lab_entry_delete($1)`, [id], { commit: true })).ok)
  ok('owner deletes', (await as(c, U.rider, `SELECT lab_entry_delete($1)`, [id], { commit: true })).ok)
  await c.query(`UPDATE coaching_relationships SET status='ended' WHERE coach_id=$1`, [U.coach])
  ok('ended coach loses access to glucose', !(await list(U.coach, U.rider, 'fueling')).ok)
  await c.query(`DELETE FROM public.profiles WHERE id=$1`, [U.rider])
  ok('entries are deleted with the profile', (await c.query(`SELECT 1 FROM lab_protocol_entries WHERE athlete_id=$1`, [U.rider])).rowCount === 0)
}
