// Repro for the "approved is_indoor edit not applied" report. Run with harness.mjs, see README.
import assert from 'node:assert/strict'
const uid = () => crypto.randomUUID()
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }

export async function run(c) {
  const admin = uid(), user = uid()
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  for (const u of [admin, user]) {
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u, u + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [u])
  }
  await c.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [admin])
  const t = (await c.query(`INSERT INTO public.tracks (name, length_m, surface, is_indoor) VALUES ('Wood Outdoor Test', 250, 'Wood', FALSE) RETURNING id`)).rows[0].id
  const s = (await c.query(
    `INSERT INTO public.suggestions (entity_type, target_id, payload, submitter_id) VALUES ('velodrome', $1, '{"is_indoor": true}', $2) RETURNING id`,
    [t, user])).rows[0].id
  await c.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`)
  await c.query('BEGIN')
  await c.query(`SET LOCAL ROLE authenticated`)
  await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [admin])
  await c.query(`SELECT public.review_suggestion($1, TRUE, NULL)`, [s])
  await c.query('COMMIT')
  const row = (await c.query(`SELECT is_indoor FROM public.tracks WHERE id = $1`, [t])).rows[0]
  ok('approved is_indoor suggestion is applied to tracks', row.is_indoor === true)
}
