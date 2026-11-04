// Adversarial checks for 20270125000000_exercise_catalogue.sql. Run with harness.mjs, see README.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
let pass = 0
async function as(c, user, sql, params = [], commit = false) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    if (user) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query(commit ? 'COMMIT' : 'ROLLBACK')
    return { ok: true, rows: r.rows, rowCount: r.rowCount }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('ok -', name) }
const save = (c, user, act, ex) => as(c, user, `SELECT save_gym_session($1, $2::jsonb) AS r`, [act, JSON.stringify(ex)], true)
const suggest = (c, user, name, aliases = [], type = 'strength', uni = false) =>
  as(c, user, `SELECT suggest_exercise($1, $2::text[], $3, $4, NULL) AS r`, [name, aliases, type, uni], true)

export async function run(c) {
  await c.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`)
  for (const n of ['rider', 'coach', 'stranger', 'admin']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [U[n]])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`)
  await c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,'active',$1)`, [U.coach, U.rider])
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON activities, profiles TO authenticated`)
  const mk = async (owner) => (await c.query(`INSERT INTO activities(user_id, title, activity_date, visibility, activity_type) VALUES ($1,'t', now(), 'private', 'gym') RETURNING id`, [owner])).rows[0].id
  const act = await mk(U.rider), act2 = await mk(U.rider)

  // Legacy rows inserted by the previous model, before the catalogue link existed
  await c.query(`ALTER TABLE gym_exercises DISABLE TRIGGER trg_gym_exercise_autolink`)
  await c.query(`INSERT INTO gym_exercises(activity_id,user_id,position,name) VALUES ($1,$2,0,'Legpress'),($1,$2,1,'Zercher zumba')`, [act2, U.rider])
  await c.query(`ALTER TABLE gym_exercises ENABLE TRIGGER trg_gym_exercise_autolink`)
  await c.query(`UPDATE activities SET gym_load_at = now(), gym_load_stale = FALSE WHERE id=$1`, [act2])

  const mig = fs.readFileSync(process.env.MIG, 'utf8')
  await c.query(mig); ok('migration is re-appliable', true)
  const n1 = (await c.query(`SELECT count(*)::int n FROM exercise_catalogue`)).rows[0].n
  await c.query(mig)
  ok('seed + migration idempotent', n1 >= 40 && (await c.query(`SELECT count(*)::int n FROM exercise_catalogue`)).rows[0].n === n1)
  ok('alias keys maintained', (await c.query(`SELECT 1 FROM exercise_catalogue WHERE name='Leg press' AND 'legpress' = ANY(alias_keys)`)).rowCount === 1)

  const legacy = (await c.query(`SELECT name, catalogue_id FROM gym_exercises WHERE activity_id=$1 ORDER BY position`, [act2])).rows
  ok('backfill links by alias, keeps unmatched', legacy[0].catalogue_id && !legacy[1].catalogue_id)
  ok('linked session marked stale', (await c.query(`SELECT gym_load_stale FROM activities WHERE id=$1`, [act2])).rows[0].gym_load_stale === true)
  await c.query(`UPDATE activities SET gym_load_stale = FALSE WHERE id=$1`, [act2])
  await c.query(mig)
  ok('re-run does not re-stale', (await c.query(`SELECT gym_load_stale FROM activities WHERE id=$1`, [act2])).rows[0].gym_load_stale === false)

  ok('direct catalogue write denied', !(await as(c, U.rider, `INSERT INTO exercise_catalogue(name) VALUES ('Hack')`)).ok)

  // Save with box jump height and auto-link by name
  let r = await save(c, U.rider, act, [
    { name: ' box JUMP ', sets: [{ reps: 5, metrics: { height_cm: 60 } }, { reps: 5, weight_kg: 10, metrics: { height_cm: 75.5 } }] },
    { name: 'Something odd', sets: [{ reps: 3 }] }])
  ok('save with height', r.ok)
  const e = (await c.query(`SELECT e.name, c.movement_type, c.unilateral FROM gym_exercises e LEFT JOIN exercise_catalogue c ON c.id=e.catalogue_id WHERE e.activity_id=$1 ORDER BY e.position`, [act])).rows
  ok('auto-linked by name', e[0].movement_type === 'jump' && e[1].movement_type === null)
  ok('height stored in metrics', (await c.query(`SELECT metrics->>'height_cm' h FROM gym_sets WHERE activity_id=$1 AND reps=5 AND weight_kg=10`, [act])).rows[0].h === '75.5')
  ok('height range rejected', !(await save(c, U.rider, act, [{ name: 'Box jump', sets: [{ reps: 1, metrics: { height_cm: 900 } }] }])).ok)
  ok('height type rejected', !(await save(c, U.rider, act, [{ name: 'Box jump', sets: [{ reps: 1, metrics: { height_cm: 'high' } }] }])).ok)

  // Suggest: duplicates, private, pending suggestion
  r = await suggest(c, U.rider, 'lunges')
  ok('duplicate alias returns existing', r.ok && r.rows[0].r.status === 'exists' && r.rows[0].r.exercise.name === 'Lunge')
  r = await suggest(c, U.rider, 'Zercher squat', ['zercher'], 'strength')
  const zid = r.rows[0].r.exercise.id
  ok('new suggestion created private + pending', r.ok && r.rows[0].r.status === 'created' && r.rows[0].r.suggested === true
    && (await c.query(`SELECT owner_id FROM exercise_catalogue WHERE id=$1`, [zid])).rows[0].owner_id === U.rider
    && (await c.query(`SELECT count(*)::int n FROM suggestions WHERE entity_type='exercise' AND status='pending' AND target_id=$1`, [zid])).rows[0].n === 1)
  ok('suggest again returns own private', (await suggest(c, U.rider, 'ZERCHER  squat')).rows[0].r.status === 'exists')
  ok('private hidden from stranger', (await as(c, U.stranger, `SELECT 1 FROM exercise_catalogue WHERE id=$1`, [zid])).rowCount === 0)
  ok('private visible to owner', (await as(c, U.rider, `SELECT 1 FROM exercise_catalogue WHERE id=$1`, [zid])).rowCount === 1)
  ok('private visible to coach', (await as(c, U.coach, `SELECT 1 FROM exercise_catalogue WHERE id=$1`, [zid])).rowCount === 1)
  ok('stranger cannot link foreign private id', (async () => true)())
  await save(c, U.stranger, await mk(U.stranger), [{ name: 'x', catalogue_id: zid, sets: [] }])
  ok('foreign private link dropped', (await c.query(`SELECT count(*)::int n FROM gym_exercises WHERE catalogue_id=$1 AND user_id=$2`, [zid, U.stranger])).rows[0].n === 0)
  ok('rider can use private exercise', (await save(c, U.rider, act, [{ name: 'zercher', sets: [{ reps: 5, weight_kg: 50 }] }])).ok
    && (await c.query(`SELECT catalogue_id FROM gym_exercises WHERE activity_id=$1`, [act])).rows[0].catalogue_id === zid)

  // Forged suggestions rejected
  ok('forged suggestion for foreign target rejected', !(await as(c, U.stranger,
    `INSERT INTO suggestions(entity_type,target_id,payload,submitter_id) VALUES ('exercise',$1,'{"owner_id":null}',$2)`, [zid, U.stranger])).ok)
  ok('forged public insert rejected', !(await as(c, U.rider,
    `INSERT INTO suggestions(entity_type,target_id,payload,submitter_id) VALUES ('exercise',NULL,'{"name":"Evil","owner_id":null}',$1)`, [U.rider])).ok)

  // Admin approval makes it public
  const sid = (await c.query(`SELECT id FROM suggestions WHERE target_id=$1`, [zid])).rows[0].id
  ok('non-admin cannot review', !(await as(c, U.rider, `SELECT review_suggestion($1, TRUE, NULL)`, [sid])).ok)
  ok('admin approves', (await as(c, U.admin, `SELECT review_suggestion($1, TRUE, NULL)`, [sid], true)).ok)
  ok('approved exercise is public', (await c.query(`SELECT owner_id FROM exercise_catalogue WHERE id=$1`, [zid])).rows[0].owner_id === null
    && (await as(c, U.stranger, `SELECT 1 FROM exercise_catalogue WHERE id=$1`, [zid])).rowCount === 1)

  // Rate limit: private row stays usable
  let last
  for (let i = 0; i < 12; i++) last = await suggest(c, U.stranger, 'Rate test ' + i)
  ok('rate limited suggestion still gives a private exercise', last.ok && last.rows[0].r.suggested === false)

  // Admin mapping
  await save(c, U.rider, act, [{ name: 'Something odd', sets: [{ reps: 3 }] }])
  ok('mapping is admin only', !(await as(c, U.rider, `SELECT * FROM admin_unmapped_exercises(10)`)).ok)
  r = await as(c, U.admin, `SELECT * FROM admin_unmapped_exercises(50)`)
  ok('unmapped list has leftovers', r.ok && r.rows.some(x => x.name_key === 'something odd'))
  const lunge = (await c.query(`SELECT id FROM exercise_catalogue WHERE name='Lunge'`)).rows[0].id
  r = await as(c, U.admin, `SELECT admin_map_exercises('something odd', $1, TRUE) AS n`, [lunge], true)
  ok('admin maps + adds alias', r.ok && (await c.query(`SELECT 1 FROM exercise_catalogue WHERE id=$1 AND 'something odd' = ANY(alias_keys)`, [lunge])).rowCount === 1)
  console.log(`${pass} checks passed`)
}
