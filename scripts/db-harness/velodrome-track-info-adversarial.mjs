// Velodrome track info schema (20270135000000_velodrome_track_info.sql). Run with harness.mjs, see README.
import assert from 'node:assert/strict'
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }
const rejects = async (name, c, sql, params = []) => {
  await c.query('BEGIN')
  let failed = false
  try { await c.query(sql, params) } catch { failed = true }
  await c.query('ROLLBACK')
  ok(name, failed)
}

export async function run(c) {
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  const t = (await c.query(`INSERT INTO public.tracks (name, length_m, surface, is_indoor) VALUES ('Info Test', 250, 'Wood', TRUE) RETURNING id`)).rows[0].id
  const up = (field, status, value, url, hash, date = '2026-11-05', json = null) => c.query(
    `SELECT public.upsert_track_info_source($1,$2,$3,$4,$5,$6,'operator','q','high',$7,$8::date) AS id`,
    [t, field, status, value, json, url, hash, date])

  // constraints on tracks
  await rejects('phone without organisational flag is rejected', c, `UPDATE public.tracks SET phone = '+441234567' WHERE id = $1`, [t])
  await c.query(`UPDATE public.tracks SET phone = '+44 20 1234 5678', contact_is_organisational = TRUE WHERE id = $1`, [t])
  await rejects('bad currency rejected', c, `UPDATE public.tracks SET price_min = 1, price_currency = 'gbp' WHERE id = $1`, [t])
  await rejects('price without currency rejected', c, `UPDATE public.tracks SET price_min = 1 WHERE id = $1`, [t])
  await rejects('min > max rejected', c, `UPDATE public.tracks SET price_min = 5, price_max = 1, price_currency = 'EUR' WHERE id = $1`, [t])
  await rejects('bad status rejected', c, `UPDATE public.tracks SET operating_status = 'demolished' WHERE id = $1`, [t])
  await rejects('javascript: website rejected', c, `UPDATE public.tracks SET website_url = 'javascript:alert(1)' WHERE id = $1`, [t])
  await rejects('bad hours spec rejected', c, `UPDATE public.tracks SET opening_hours_spec = 'always open' WHERE id = $1`, [t])
  await c.query(`UPDATE public.tracks SET opening_hours = 'Mon-Fri 06-22', opening_hours_spec = 'Mo-Fr 06:00-22:00; Sa 07:00-20:00' WHERE id = $1`, [t])
  await c.query(`UPDATE public.tracks SET opening_hours = 'Mon-Fri 07-22' WHERE id = $1`, [t])
  ok('editing opening_hours text clears stale spec',
    (await c.query(`SELECT opening_hours_spec FROM public.tracks WHERE id = $1`, [t])).rows[0].opening_hours_spec === null)

  // sources: idempotent upsert, history, not_found, derived date
  const a = (await up('website_url', 'verified', 'https://a.example/', 'https://a.example/', 'h1')).rows[0].id
  const b = (await up('website_url', 'verified', 'https://a.example/', 'https://a.example/', 'h1', '2026-12-01')).rows[0].id
  ok('same value re-check reuses the current row', a === b)
  ok('re-check bumps verified_at', (await c.query(`SELECT verified_at::text d FROM public.track_info_sources WHERE id = $1`, [a])).rows[0].d === '2026-12-01')
  await up('website_url', 'verified', 'https://b.example/', 'https://b.example/', 'h2', '2027-01-01')
  const rows = (await c.query(`SELECT is_current FROM public.track_info_sources WHERE track_id = $1 AND field = 'website_url'`, [t])).rows
  ok('changed value keeps history with exactly one current row', rows.length === 2 && rows.filter((r) => r.is_current).length === 1)
  await up('email', 'not_found', null, null, null, '2027-01-02')
  ok('not_found is representable without a source url', true)
  await rejects('verified without source url rejected', c, `SELECT public.upsert_track_info_source($1,'phone','verified','1',NULL,NULL,NULL,NULL,NULL,NULL,CURRENT_DATE)`, [t])
  await rejects('non-http source url rejected', c, `SELECT public.upsert_track_info_source($1,'phone','verified','1',NULL,'ftp://x/',NULL,NULL,NULL,NULL,CURRENT_DATE)`, [t])
  await rejects('unknown field rejected', c, `SELECT public.upsert_track_info_source($1,'colour','verified','1',NULL,'https://x/',NULL,NULL,NULL,NULL,CURRENT_DATE)`, [t])
  ok('info_verified_at derives from verified rows only',
    (await c.query(`SELECT info_verified_at::text d FROM public.tracks WHERE id = $1`, [t])).rows[0].d === '2027-01-01')

  // due queue
  const due = (await c.query(`SELECT field, reason FROM public.track_info_refresh_due WHERE track_id = $1`, [t])).rows
  ok('never-checked fields are due, checked ones are not',
    due.some((r) => r.field === 'phone' && r.reason === 'never_checked') && !due.some((r) => r.field === 'email'))

  // privileges
  await up('operator', 'needs_attention', 'X', 'https://x.example/', 'h')
  for (const role of ['anon', 'authenticated']) {
    await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`)
    const vis = (await c.query(`SELECT status FROM public.track_info_sources WHERE track_id = $1`, [t])).rows
    ok(`${role} sees only current verified provenance`, vis.length === 1 && vis[0].status === 'verified')
    await c.query('ROLLBACK')
    for (const sql of [`INSERT INTO public.track_info_sources (track_id, field, status, source_url, verified_at) VALUES ('${t}','operator','verified','https://x/',CURRENT_DATE)`,
      `UPDATE public.track_info_sources SET value = 'x'`, `DELETE FROM public.track_info_sources`,
      `SELECT public.upsert_track_info_source('${t}','operator','verified','x',NULL,'https://x/',NULL,NULL,NULL,NULL,CURRENT_DATE)`,
      `SELECT * FROM public.track_info_refresh_due`]) {
      await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`)
      let failed = false
      try { await c.query(sql) } catch { failed = true }
      await c.query('ROLLBACK')
      ok(`${role} cannot: ${sql.slice(0, 50)}`, failed)
    }
  }

  // suggestions: new fields are suggestible, contacts are not
  const allowed = (await c.query(`SELECT allowed_columns FROM public.suggestion_targets WHERE entity_type = 'velodrome'`)).rows[0].allowed_columns
  ok('operator/year_built/price/status are suggestible', ['operator', 'year_built', 'opening_hours', 'price_min', 'price_max', 'price_currency', 'operating_status'].every((k) => allowed.includes(k)))
  ok('phone/email/contact flag are not suggestible', !['phone', 'email', 'contact_is_organisational', 'info_verified_at', 'opening_hours_spec'].some((k) => allowed.includes(k)))
}
