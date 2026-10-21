// Adversarial checks for 20261225000000_ride_type_and_gears.sql (issue #279). Run with harness.mjs, see README.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
let pass = 0
async function as(c, user, sql, params = []) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    if (user) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query('ROLLBACK')
    return { ok: true, rows: r.rows, rowCount: r.rowCount }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}
// Like `as`, but commits so later statements see the change.
async function asCommit(c, user, sql, params = []) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE authenticated`)
    await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query('COMMIT')
    return { ok: true, rows: r.rows, rowCount: r.rowCount }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('ok -', name) }
const G = (id, chainring, cog, note) => ({ id, chainring, cog, ...(note ? { note } : {}) })

export async function run(c) {
  for (const n of ['rider', 'coach', 'stranger', 'pending', 'ended', 'blocked', 'rider2']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [U[n]])
  }
  const rel = (coach, rider, status) => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,$3,$1)`, [coach, rider, status])
  await rel(U.ended, U.rider, 'ended'); await rel(U.pending, U.rider, 'pending'); await rel(U.coach, U.rider, 'active')
  await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1,$2)`, [U.rider, U.blocked])
  await rel(U.blocked, U.rider2, 'active'); await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1,$2)`, [U.rider2, U.blocked])

  // Supabase grants table privileges to authenticated by default; the stub harness does not.
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON activities, profiles TO authenticated`)
  const mkAct = async (owner, extra = '') =>
    (await c.query(`INSERT INTO activities(user_id, title, activity_date, visibility, chainring, cog) VALUES ($1,'t', now(), 'private', ${extra || 'NULL, NULL'}) RETURNING id`, [owner])).rows[0].id
  const legacy = await mkAct(U.rider, '52, 14')
  const act = await mkAct(U.rider)
  const act2 = await mkAct(U.rider2)

  // idempotent re-apply
  await c.query(fs.readFileSync(process.env.MIG, 'utf8')); ok('migration is re-appliable', true)

  // defaults / no backfill
  const l = (await c.query(`SELECT ride_type, gears, gear_segments, chainring, cog FROM activities WHERE id=$1`, [legacy])).rows[0]
  ok('legacy row: ride_type NULL, gears [], legacy gear untouched', l.ride_type === null && l.gears.length === 0 && l.chainring === 52 && l.cog === 14)
  ok('profile default ride type is road', (await c.query(`SELECT default_ride_type FROM profiles WHERE id=$1`, [U.rider])).rows[0].default_ride_type === 'road')

  // ride_types lookup
  ok('authenticated reads ride_types', (await as(c, U.rider, `SELECT key FROM ride_types ORDER BY sort_order`)).rows.map((r) => r.key).join() === 'road,track')
  ok('anon cannot read ride_types', !(await as(c, null, `SELECT 1 FROM ride_types`)).ok)
  ok('client cannot add ride type', !(await as(c, U.rider, `INSERT INTO ride_types(key,label) VALUES ('bmx','BMX')`)).ok)

  // rider direct write: validation
  const upd = (u, id, gears, segs = [], type = 'track') =>
    as(c, u, `UPDATE activities SET ride_type=$3, gears=$2::jsonb, gear_segments=$4::jsonb WHERE id=$1`, [id, JSON.stringify(gears), type, JSON.stringify(segs)])
  const good = [G('a', 52, 14, 'warm-up'), G('b', 60, 15)]
  ok('rider valid gears + segments', (await upd(U.rider, act, good, [{ start_s: 0, end_s: 60, gear_id: 'a' }, { start_s: 60, end_s: 120, gear_id: 'b' }])).rowCount === 1)
  for (const [name, gears, segs, type] of [
    ['missing cog', [{ id: 'a', chainring: 52 }], [], 'track'],
    ['teeth out of range', [G('a', 5, 14)], [], 'track'],
    ['fractional teeth', [G('a', 52.5, 14)], [], 'track'],
    ['string teeth', [{ id: 'a', chainring: '52', cog: 14 }], [], 'track'],
    ['duplicate ids', [G('a', 52, 14), G('a', 50, 15)], [], 'track'],
    ['bad id', [G('a b', 52, 14)], [], 'track'],
    ['9 gears', Array.from({ length: 9 }, (_, i) => G('g' + i, 52, 14)), [], 'track'],
    ['long note', [G('a', 52, 14, 'x'.repeat(81))], [], 'track'],
    ['segment unknown gear', good, [{ start_s: 0, end_s: 10, gear_id: 'zz' }], 'track'],
    ['segment overlap', good, [{ start_s: 0, end_s: 60, gear_id: 'a' }, { start_s: 30, end_s: 90, gear_id: 'b' }], 'track'],
    ['segment end<=start', good, [{ start_s: 10, end_s: 10, gear_id: 'a' }], 'track'],
    ['segment negative', good, [{ start_s: -1, end_s: 10, gear_id: 'a' }], 'track'],
    ['unknown ride type', good, [], 'bogus'],
  ]) ok(`rejects ${name}`, !(await upd(U.rider, act, gears, segs, type)).ok)

  // mirror + stamps
  await asCommit(c, U.rider, `UPDATE activities SET ride_type='track', gears=$2::jsonb, gear_segments='[]' WHERE id=$1`, [act, JSON.stringify(good)])
  let r = (await c.query(`SELECT chainring, cog, gear_set_by, gear_set_by_coach FROM activities WHERE id=$1`, [act])).rows[0]
  ok('primary gear mirrored to chainring/cog', r.chainring === 52 && r.cog === 14)
  ok('rider edit stamped by rider, not coach', r.gear_set_by === U.rider && r.gear_set_by_coach === false)
  await asCommit(c, U.rider, `UPDATE activities SET gear_set_by_coach=true, gear_set_by=$2 WHERE id=$1`, [act, U.coach])
  r = (await c.query(`SELECT gear_set_by, gear_set_by_coach FROM activities WHERE id=$1`, [act])).rows[0]
  ok('stamp cannot be forged', r.gear_set_by === U.rider && r.gear_set_by_coach === false)
  await asCommit(c, U.rider, `UPDATE activities SET chainring=40 WHERE id=$1`, [act])
  ok('mirror wins over direct chainring write', (await c.query(`SELECT chainring FROM activities WHERE id=$1`, [act])).rows[0].chainring === 52)
  await asCommit(c, U.rider, `UPDATE activities SET title='renamed' WHERE id=$1`, [act])
  ok('title edit keeps stamp', (await c.query(`SELECT gear_set_by FROM activities WHERE id=$1`, [act])).rows[0].gear_set_by === U.rider)
  await asCommit(c, U.rider, `UPDATE activities SET chainring=48, cog=16 WHERE id=$1`, [legacy])
  ok('legacy row (no gears) still takes direct chainring/cog writes', (await c.query(`SELECT chainring, cog FROM activities WHERE id=$1`, [legacy])).rows[0].chainring === 48)

  // coach
  const rpc = (u, id, changes) => asCommit(c, u, `SELECT set_activity_gear($1, $2::jsonb) j`, [id, JSON.stringify(changes)])
  const coachGears = [G('c1', 56, 14, 'tempo'), G('c2', 62, 14, 'flying 200')]
  const cr = await rpc(U.coach, act, { ride_type: 'track', gears: coachGears, gear_segments: [{ start_s: 5, end_s: 50, gear_id: 'c2' }] })
  ok('active coach edits gears via RPC', cr.ok)
  r = (await c.query(`SELECT chainring, cog, gear_set_by, gear_set_by_coach, ride_type FROM activities WHERE id=$1`, [act])).rows[0]
  ok('coach edit stamped from auth.uid() with set_by_coach', r.gear_set_by === U.coach && r.gear_set_by_coach === true && r.chainring === 56)
  const audit = (await c.query(`SELECT coach_id, rider_id, table_name, row_id, old_values, new_values FROM coach_edits WHERE rider_id=$1 AND table_name='activities'`, [U.rider])).rows
  ok('coach edit audited', audit.length === 1 && audit[0].coach_id === U.coach && audit[0].row_id === act && audit[0].old_values.gears.length === 2 && audit[0].new_values.gears.length === 2)
  ok('rider notified once', (await c.query(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND type='coach_edited' AND read_at IS NULL`, [U.rider])).rows[0].n === 1)
  ok('coach reads gears + label via shared_activities', (await as(c, U.coach, `SELECT gears, gear_set_by_coach FROM shared_activities WHERE id=$1`, [act])).rows[0]?.gear_set_by_coach === true)
  ok('coach cannot update activities directly', (await as(c, U.coach, `UPDATE activities SET ride_type='road' WHERE id=$1`, [act])).rowCount === 0)
  ok('coach cannot insert activity', !(await as(c, U.coach, `INSERT INTO activities(user_id,title,activity_date) VALUES ($1,'x',now())`, [U.rider])).ok)
  for (const bad of [{ title: 'hax' }, { user_id: U.coach }, { visibility: 'public' }, { time_series: {} }, { gear_set_by_coach: false }, {}])
    ok(`coach RPC rejects keys ${Object.keys(bad).join(',') || '(none)'}`, !(await rpc(U.coach, act, bad)).ok)
  ok('coach RPC rejects invalid gears', !(await rpc(U.coach, act, { gears: [G('x', 2, 2)] })).ok)
  ok('coach RPC rejects unknown ride type', !(await rpc(U.coach, act, { ride_type: 'bogus' })).ok)
  ok('no-op coach edit is not audited again', (await rpc(U.coach, act, { ride_type: 'track' })).ok &&
    (await c.query(`SELECT count(*)::int n FROM coach_edits WHERE table_name='activities'`)).rows[0].n === 1)
  ok('coach cannot touch coach\'s own-athlete-less activity (rider2)', !(await rpc(U.coach, act2, { ride_type: 'track' })).ok)
  for (const n of ['stranger', 'pending', 'ended', 'blocked']) {
    const x = await rpc(U[n], act, { ride_type: 'road' })
    ok(`${n} cannot edit rider's activity`, !x.ok && /Activity not found/.test(x.err))
  }
  ok('blocked coach cannot edit own-blocker rider2 activity', !(await rpc(U.blocked, act2, { ride_type: 'road' })).ok)
  ok('missing activity id looks the same', /Activity not found/.test((await rpc(U.coach, uid(), { ride_type: 'road' })).err))
  ok('rider cannot edit another rider via RPC', !(await rpc(U.rider, act2, { ride_type: 'road' })).ok)
  ok('anon cannot call RPC', !(await as(c, null, `SELECT set_activity_gear($1,'{"ride_type":"road"}')`, [act])).ok)
  ok('activity untouched by the failed attempts', (await c.query(`SELECT ride_type, gear_set_by FROM activities WHERE id=$1`, [act])).rows[0].gear_set_by === U.coach)
  // ended coach loses read too
  ok('ended coach cannot read gears', (await as(c, U.ended, `SELECT 1 FROM shared_activities WHERE id=$1`, [act])).rows.length === 0)

  // rider switching to road keeps entries; rider edit clears the coach label
  ok('rider RPC to road keeps gears', (await rpc(U.rider, act, { ride_type: 'road' })).ok)
  r = (await c.query(`SELECT ride_type, jsonb_array_length(gears) n, gear_set_by, gear_set_by_coach FROM activities WHERE id=$1`, [act])).rows[0]
  ok('road keeps stored gears hidden, label cleared by rider', r.ride_type === 'road' && r.n === 2 && r.gear_set_by === U.rider && r.gear_set_by_coach === false)
  ok('rider can clear all gears (chainring/cog cleared)', (await rpc(U.rider, act, { gears: [], gear_segments: [] })).ok &&
    (await c.query(`SELECT chainring FROM activities WHERE id=$1`, [act])).rows[0].chainring === null)

  // profile default ride type
  const prof = (u, rider, ch) => asCommit(c, u, `SELECT coach_update_athlete_profile($1, $2::jsonb)`, [rider, JSON.stringify(ch)])
  ok('coach sets athlete default ride type', (await prof(U.coach, U.rider, { default_ride_type: 'track' })).ok)
  r = (await c.query(`SELECT default_ride_type, training_set_by, training_set_by_coach FROM profiles WHERE id=$1`, [U.rider])).rows[0]
  ok('profile stamp set by coach', r.default_ride_type === 'track' && r.training_set_by === U.coach && r.training_set_by_coach)
  ok('unknown default ride type rejected', !(await prof(U.coach, U.rider, { default_ride_type: 'bogus' })).ok)
  for (const n of ['stranger', 'pending', 'ended', 'blocked']) ok(`${n} cannot set default ride type`, !(await prof(U[n], U.rider, { default_ride_type: 'road' })).ok)
  ok('coach sees default ride type via get_athlete_profile', (await as(c, U.coach, `SELECT default_ride_type FROM get_athlete_profile($1)`, [U.rider])).rows[0]?.default_ride_type === 'track')
  ok('stranger gets nothing from get_athlete_profile', (await as(c, U.stranger, `SELECT 1 FROM get_athlete_profile($1)`, [U.rider])).rows.length === 0)
  ok('rider sets own default', (await asCommit(c, U.rider, `UPDATE profiles SET default_ride_type='road' WHERE id=$1`, [U.rider])).rowCount === 1)
  ok('rider stamp cleared', !(await c.query(`SELECT training_set_by_coach f FROM profiles WHERE id=$1`, [U.rider])).rows[0].f)
  ok('bogus default via direct update rejected', !(await as(c, U.rider, `UPDATE profiles SET default_ride_type='bogus' WHERE id=$1`, [U.rider])).ok)
  console.log(`${pass} checks passed`)
}
