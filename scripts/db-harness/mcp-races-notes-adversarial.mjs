// Adversarial checks for 20270191000000_mcp_races_notes.sql (MCP wrappers for calendar races and notes).
// Run with harness.mjs after all migrations, see README.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'

const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }
const sha = (s) => createHash('sha256').update(s).digest('hex')

async function svc(c, sql, params = []) {
  await c.query('BEGIN')
  try {
    await c.query('SET LOCAL ROLE service_role')
    const r = await c.query(sql, params)
    await c.query('COMMIT')
    return { ok: true, rows: r.rows }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}
async function asRole(c, role, sql, params = []) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${role}`)
    await c.query(sql, params)
    await c.query('ROLLBACK')
    return true
  } catch {
    await c.query('ROLLBACK')
    return false
  }
}

export async function run(c) {
  const U = {}
  for (const n of ['rider', 'coach', 'stranger', 'owner']) {
    U[n] = randomUUID()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by,responded_at) VALUES ($1,$2,'active',$1,now())`, [U.coach, U.rider])
  const app = (await c.query(
    `INSERT INTO developer_apps(owner_user_id, name, slug, client_id, scopes, status) VALUES ($1,'Claude','claude','cid',$2,'approved') RETURNING id`,
    [U.owner, ['profile:read', 'plans:read', 'plans:write', 'activities:read']]
  )).rows[0].id
  const token = async (user, scopes) => {
    const t = randomUUID()
    await c.query(
      `INSERT INTO oauth_grants(family_id, app_id, user_id, scopes, access_token_hash, access_expires_at, refresh_token_hash, refresh_expires_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now() + interval '1 hour', $5, now() + interval '30 days')`,
      [app, user, scopes, sha(t), sha(t + 'r')]
    )
    return sha(t)
  }
  const RW = ['plans:read', 'plans:write']
  const T = { rider: await token(U.rider, RW), coach: await token(U.coach, RW), stranger: await token(U.stranger, RW), ro: await token(U.rider, ['plans:read']) }

  // Races
  let r = await svc(c, `SELECT * FROM mcp_race_create($1, NULL, '2027-05-10', $2::jsonb)`, [T.rider, JSON.stringify({ name: 'Gran Fondo', priority: 'A', location: ' Prague ' })])
  ok('rider creates an own race', r.ok && r.rows[0].rider_id === U.rider && r.rows[0].location === 'Prague' && r.rows[0].set_by_coach === false && r.rows[0].created_by === U.rider)
  const race = r.rows[0].id
  r = await svc(c, `SELECT * FROM mcp_race_create($1, $2, '2027-06-01', $3::jsonb)`, [T.coach, U.rider, JSON.stringify({ name: 'Nationals', discipline: 'track', priority: 'B' })])
  ok('coach creates a race on the athlete calendar, stamped set_by_coach', r.ok && r.rows[0].set_by_coach === true && r.rows[0].created_by === U.coach)
  r = await svc(c, `SELECT * FROM mcp_race_create($1, $2, '2027-06-01', $3::jsonb)`, [T.stranger, U.rider, JSON.stringify({ name: 'x' })])
  ok('stranger cannot create a race for the rider', !r.ok && /Rider not found/.test(r.err))
  r = await svc(c, `SELECT * FROM mcp_race_create($1, NULL, '2027-06-01', $2::jsonb)`, [T.ro, JSON.stringify({ name: 'x' })])
  ok('plans:read token cannot create', !r.ok && /insufficient_scope/.test(r.err))
  r = await svc(c, `SELECT * FROM mcp_race_create($1, NULL, '2027-06-01', $2::jsonb)`, [T.rider, JSON.stringify({ name: 'x', priority: 'Z' })])
  ok('invalid priority -> friendly error', !r.ok && /Invalid race values/.test(r.err))
  r = await svc(c, `SELECT * FROM mcp_race_create($1, NULL, '2027-06-01', $2::jsonb)`, [T.rider, JSON.stringify({ name: 'x', activity_id: randomUUID() })])
  ok('non-writable field is rejected', !r.ok && /Invalid fields/.test(r.err))
  r = await svc(c, `SELECT * FROM mcp_race_create($1, NULL, '2027-06-01', '{"name":"x"}'::jsonb)`, [sha('bogus')])
  ok('unknown token is rejected', !r.ok && /invalid_token/.test(r.err))

  r = await svc(c, `SELECT * FROM mcp_races_list($1, NULL, '2027-01-01', '2027-12-31')`, [T.ro])
  ok('rider lists own races with a read token', r.ok && r.rows.length === 2)
  r = await svc(c, `SELECT * FROM mcp_races_list($1, $2, '2027-01-01', '2027-12-31')`, [T.coach, U.rider])
  ok('coach lists athlete races', r.ok && r.rows.length === 2)
  r = await svc(c, `SELECT * FROM mcp_races_list($1, $2, '2027-01-01', '2027-12-31')`, [T.stranger, U.rider])
  ok('stranger cannot list rider races', !r.ok)
  r = await svc(c, `SELECT * FROM mcp_races_list($1, NULL, '2026-01-01', '2027-12-31')`, [T.rider])
  ok('range over 366 days is refused', !r.ok && /366/.test(r.err))

  r = await svc(c, `SELECT * FROM mcp_race_update($1, $2, $3::jsonb)`, [T.coach, race, JSON.stringify({ race_date: '2027-05-11', priority: 'B' })])
  ok('coach updates the athlete race (partial), keeps created stamps', r.ok && r.rows[0].priority === 'B' && r.rows[0].name === 'Gran Fondo' && r.rows[0].updated_by === U.coach && r.rows[0].set_by_coach === false)
  r = await svc(c, `SELECT * FROM mcp_race_update($1, $2, $3::jsonb)`, [T.stranger, race, JSON.stringify({ name: 'pwn' })])
  ok('stranger cannot update', !r.ok && /Race not found/.test(r.err))
  r = await svc(c, `SELECT * FROM mcp_race_update($1, $2, $3::jsonb)`, [T.rider, race, JSON.stringify({ rider_id: U.stranger })])
  ok('rider_id cannot be changed', !r.ok && /Invalid fields/.test(r.err))
  r = await svc(c, `SELECT * FROM mcp_race_delete($1, $2)`, [T.stranger, race])
  ok('stranger cannot delete', !r.ok && /Race not found/.test(r.err))
  r = await svc(c, `SELECT * FROM mcp_race_delete($1, $2)`, [T.rider, race])
  ok('rider deletes own race', r.ok && (await c.query('SELECT 1 FROM calendar_races WHERE id = $1', [race])).rowCount === 0)

  // Notes
  r = await svc(c, `SELECT * FROM mcp_note_create($1, NULL, '2026-12-03', $2::jsonb)`, [T.rider, JSON.stringify({ title: ' Ill ', body: 'Fever' })])
  ok('rider creates a note', r.ok && r.rows[0].title === 'Ill' && r.rows[0].created_by === U.rider)
  const note = r.rows[0].id
  r = await svc(c, `SELECT * FROM mcp_note_create($1, $2, '2026-12-04', $3::jsonb)`, [T.coach, U.rider, JSON.stringify({ title: 'Camp' })])
  ok('coach writes a note on the athlete calendar', r.ok && r.rows[0].set_by_coach === true)
  r = await svc(c, `SELECT * FROM mcp_note_create($1, $2, '2026-12-04', $3::jsonb)`, [T.stranger, U.rider, JSON.stringify({ title: 'x' })])
  ok('stranger cannot write a note', !r.ok)
  r = await svc(c, `SELECT * FROM mcp_note_create($1, NULL, '2026-12-04', $2::jsonb)`, [T.rider, JSON.stringify({ title: 'x'.repeat(81) })])
  ok('too long title -> friendly error', !r.ok && /Invalid note values/.test(r.err))
  r = await svc(c, `SELECT * FROM mcp_notes_list($1, $2, '2026-12-01', '2026-12-31')`, [T.coach, U.rider])
  ok('coach lists athlete notes', r.ok && r.rows.length === 2)
  r = await svc(c, `SELECT * FROM mcp_note_update($1, $2, $3::jsonb)`, [T.rider, note, JSON.stringify({ body: 'Better' })])
  ok('partial note update keeps the title', r.ok && r.rows[0].title === 'Ill' && r.rows[0].body === 'Better')
  r = await svc(c, `SELECT * FROM mcp_note_update($1, $2, $3::jsonb)`, [T.stranger, note, JSON.stringify({ body: 'x' })])
  ok('stranger cannot update a note', !r.ok && /Note not found/.test(r.err))
  r = await svc(c, `SELECT * FROM mcp_note_delete($1, $2)`, [T.ro, note])
  ok('read token cannot delete', !r.ok && /insufficient_scope/.test(r.err))
  r = await svc(c, `SELECT * FROM mcp_note_delete($1, $2)`, [T.coach, note])
  ok('coach deletes the athlete note', r.ok)

  // Grants
  for (const role of ['anon', 'authenticated']) {
    ok(`${role} cannot execute the wrappers`, !(await asRole(c, role, `SELECT * FROM mcp_notes_list($1, NULL, '2026-12-01', '2026-12-31')`, [T.rider])))
  }
}
