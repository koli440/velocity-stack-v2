// Velodrome info data migrations (20270136*): tolerant, fill-only, idempotent. Run with harness.mjs, see README.
// The harness has already applied every migration (helper, strict_*, relaxed_*, penrose); this re-applies and attacks them.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }
// MIGDIR overrides the directory when this file is copied out of the repo (see README)
const DIR = process.env.MIGDIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations')

export async function run(c) {
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  const q = async (sql, p = []) => (await c.query(sql, p)).rows
  const files = fs.readdirSync(DIR).filter((f) => /^2027013(601|602|603)\d+_velodrome_.*\.sql$/.test(f)).sort()
  const data = files.filter((f) => /_velodrome_info_(strict|relaxed)_/.test(f))
  ok('data is split into several small migrations', data.length >= 8 && data.every((f) => fs.statSync(path.join(DIR, f)).size < 50000))
  ok('versions sort after the schema migration', files.every((f) => f > '20270135000000') && fs.existsSync(path.join(DIR, '20270136000000_velodrome_info_apply_helper.sql')))
  const sqls = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(DIR, f), 'utf8')]))
  const applyAll = async () => { for (const f of files) await c.query(sqls[f]) }
  const snapshot = async () => JSON.stringify([
    await q(`SELECT id, website_url, booking_url, pricing_url, operator, year_built, phone, email, opening_hours, price_min, price_max, price_currency, operating_status, contact_is_organisational, notes FROM public.tracks ORDER BY id`),
    await q(`SELECT track_id, field, status, value, source_url, is_current FROM public.track_info_sources ORDER BY track_id, field, id`),
    await q(`SELECT batch, track_name, field, outcome FROM public.track_info_apply_log ORDER BY id`),
  ])
  const logOf = (outcome, name) => q(`SELECT * FROM public.track_info_apply_log WHERE outcome = $1 AND track_name = $2`, [outcome, name])

  // ---- state after the harness applied the whole set ----
  const verified = (await q(`SELECT count(*)::int AS n FROM public.track_info_sources WHERE status = 'verified' AND is_current`))[0].n
  ok('migrations inserted verified rows', verified > 100)
  const log = await q(`SELECT outcome, count(*)::int AS n FROM public.track_info_apply_log GROUP BY 1`)
  console.log('apply log after full set:', JSON.stringify(log))
  ok('no batch/track errors or rejected fields on the seed data', log.every((r) => !['batch_error', 'track_error', 'field_rejected'].includes(r.outcome)))
  const lv = await q(`SELECT website_url, booking_url, pricing_url, operator, opening_hours, price_min, price_max, price_currency FROM public.tracks WHERE name ILIKE '%Lee Valley VeloPark%' AND country_code = 'GBR'`)
  ok('Lee Valley VeloPark exists once', lv.length === 1)
  ok('Lee Valley gets all six values', ['website_url', 'booking_url', 'pricing_url', 'operator', 'opening_hours', 'price_min', 'price_max', 'price_currency'].every((k) => lv[0][k] != null))
  ok('Lee Valley hours state their scope', /^Whole venue:/.test(lv[0].opening_hours))
  ok('Lee Valley price is GBP 12.25-47.2', Number(lv[0].price_min) === 12.25 && Number(lv[0].price_max) === 47.2 && lv[0].price_currency === 'GBP')
  ok('info_verified_at is derived for filled tracks', (await q(`SELECT 1 FROM public.tracks WHERE website_url IS NOT NULL AND info_verified_at IS NULL`)).length === 0)
  ok('no value comes from wikipedia/aggregators', (await q(`SELECT 1 FROM public.track_info_sources WHERE is_current AND status = 'verified' AND source_url ~* '(wikipedia|facebook|tripadvisor|yelp)'`)).length === 0)
  ok('no sources without a url unless not_found', (await q(`SELECT 1 FROM public.track_info_sources WHERE source_url IS NULL AND status <> 'not_found'`)).length === 0)
  ok('every phone/email is flagged organisational', (await q(`SELECT 1 FROM public.tracks WHERE (phone IS NOT NULL OR email IS NOT NULL) AND contact_is_organisational IS NOT TRUE`)).length === 0)
  ok('every verified source value is in the column it describes', (await q(`
    SELECT 1 FROM public.track_info_sources s JOIN public.tracks t ON t.id = s.track_id
    WHERE s.is_current AND s.status = 'verified' AND s.field IN ('website_url','booking_url','pricing_url','operator','opening_hours')
      AND CASE s.field WHEN 'website_url' THEN t.website_url WHEN 'booking_url' THEN t.booking_url WHEN 'pricing_url' THEN t.pricing_url
                       WHEN 'operator' THEN t.operator ELSE t.opening_hours END IS DISTINCT FROM s.value`)).length === 0)
  ok('held tracks untouched (Calgary Olympic Oval, Arima)', (await q(`
    SELECT 1 FROM public.tracks t WHERE (t.name ILIKE 'Olympic Oval%' OR t.name ILIKE 'Arima%')
      AND (t.website_url IS NOT NULL OR t.operator IS NOT NULL OR t.phone IS NOT NULL)`)).length === 0)
  ok('penrose spam domain no longer stored', (await q(`SELECT 1 FROM public.tracks WHERE notes ~* 'penroseparkvelo\\.com'`)).length === 0)
  ok('penrose location text kept', (await q(`SELECT 1 FROM public.tracks WHERE name ILIKE '%penrose%' AND notes ILIKE '%Saint Louis%'`)).length === 1)
  ok('apply log and helpers are not public', (await q(`SELECT 1 FROM information_schema.role_table_grants WHERE table_name = 'track_info_apply_log' AND grantee IN ('anon','authenticated','PUBLIC')`)).length === 0
    && !(await q(`SELECT has_function_privilege('anon', 'public.apply_velodrome_info(text, jsonb)', 'EXECUTE') AS p`))[0].p)

  // ---- idempotent re-run of the whole set ----
  const before = await snapshot()
  await applyAll()
  ok('re-running every data migration is a no-op (idempotent)', (await snapshot()) === before)

  // ---- fill-only: a differing manual value survives and is recorded as needs_attention ----
  const row = (await q(`SELECT t.id, s.id AS sid FROM public.tracks t JOIN public.track_info_sources s ON s.track_id = t.id AND s.field = 'website_url' AND s.is_current AND s.status = 'verified' WHERE t.name ILIKE '%Lee Valley VeloPark%' LIMIT 1`))[0]
  await c.query(`UPDATE public.tracks SET website_url = 'https://manual.example/' WHERE id = $1`, [row.id])
  await c.query(`DELETE FROM public.track_info_sources WHERE id = $1`, [row.sid])
  await applyAll()
  ok('fill-only keeps the existing different value', (await q(`SELECT website_url FROM public.tracks WHERE id = $1`, [row.id]))[0].website_url === 'https://manual.example/')
  ok('conflict recorded as needs_attention', (await q(`SELECT 1 FROM public.track_info_sources WHERE track_id = $1 AND field = 'website_url' AND is_current AND status = 'needs_attention'`, [row.id])).length === 1)
  ok('conflict is in the apply log', (await q(`SELECT 1 FROM public.track_info_apply_log WHERE outcome = 'field_conflict' AND field = 'website_url'`)).length >= 1)

  // ---- an unmatched track is skipped and logged, never fatal; the rest of the migration still applies ----
  const target = data.find((f) => /_strict_01/.test(f))
  const firstName = JSON.parse(sqls[target].match(/\$json\$([\s\S]*?)\$json\$/)[1])[0].name
  const victim = (await q(`SELECT id FROM public.tracks WHERE name = $1`, [firstName]))[0].id
  await c.query(`DELETE FROM public.track_info_sources WHERE track_id = $1`, [victim])
  await c.query(`UPDATE public.tracks SET website_url = NULL, operator = NULL, phone = NULL, email = NULL, contact_is_organisational = FALSE, opening_hours = NULL, booking_url = NULL, pricing_url = NULL, year_built = NULL, price_min = NULL, price_max = NULL, price_currency = NULL, operating_status = 'unknown' WHERE id = $1`, [victim])
  await c.query(`UPDATE public.tracks SET name = 'Renamed in production', latitude = latitude + 5 WHERE id = $1`, [victim]) // renamed and moved: matches nothing
  let threw = false
  try { await c.query(sqls[target]) } catch (e) { threw = true }
  ok('unmatched track does not abort the migration', !threw)
  ok('unmatched track is logged as skipped_no_match', (await logOf('skipped_no_match', firstName)).length === 1)
  ok('unmatched track got nothing', (await q(`SELECT 1 FROM public.track_info_sources WHERE track_id = $1`, [victim])).length === 0)
  ok('other tracks in the same migration are still applied', (await q(`SELECT 1 FROM public.track_info_sources WHERE is_current AND status = 'verified' AND track_id IN (SELECT id FROM public.tracks WHERE name <> 'Renamed in production')`)).length > 0)

  // ---- coordinate fallback: renamed in production but same place ----
  await c.query(`UPDATE public.tracks SET name = 'Another production name', latitude = latitude - 5 WHERE id = $1`, [victim]) // back to the seed position
  await c.query(sqls[target])
  ok('renamed track is matched by coordinates and filled', (await logOf('matched_by_coordinates', firstName)).length === 1
    && (await q(`SELECT 1 FROM public.track_info_sources WHERE track_id = $1 AND status IN ('verified','needs_attention','not_found')`, [victim])).length > 0)
  await c.query(`UPDATE public.tracks SET name = $2 WHERE id = $1`, [victim, firstName])

  // ---- ambiguous track (two rows, same name+country and same place) is skipped, not fatal ----
  await c.query(`DROP INDEX IF EXISTS public.tracks_name_uq`) // only present when the stub DB adds unique(name) so the v1 import applies
  const dupe = (await q(`INSERT INTO public.tracks (name, country_code, length_m, surface, is_indoor, latitude, longitude) SELECT name, country_code, length_m, surface, is_indoor, latitude, longitude FROM public.tracks WHERE id = $1 RETURNING id`, [victim]))[0].id
  threw = false
  try { await c.query(sqls[target]) } catch (e) { threw = true }
  ok('ambiguous track does not abort the migration', !threw)
  ok('ambiguous track is logged as skipped_ambiguous', (await logOf('skipped_ambiguous', firstName)).length === 1)
  await c.query(`DELETE FROM public.tracks WHERE id = $1`, [dupe])

  // ---- a constraint violation is caught per field; the other fields of the track still apply ----
  const probe = (await q(`INSERT INTO public.tracks (name, country_code, length_m, surface, is_indoor) VALUES ('Constraint Probe Velodrome', 'GBR', 250, 'Wood', true) RETURNING id`))[0].id
  const entries = [
    { field: 'phone', status: 'verified', value: 'not a phone', url: 'https://probe.example/c', kind: 'operator', quote: 'q', conf: 'high', date: '2026-11-05' },
    { field: 'year_built', status: 'verified', value: '1700', url: 'https://probe.example/y', kind: 'operator', quote: 'q', conf: 'high', date: '2026-11-05' },
    { field: 'price_range', status: 'verified', value: '1-2', json: { min: 9, max: 3, currency: 'EUR' }, url: 'https://probe.example/p', kind: 'operator', quote: 'q', conf: 'high', date: '2026-11-05' },
    { field: 'operating_status', status: 'verified', value: 'sort of open', url: 'https://probe.example/s', kind: 'operator', quote: 'q', conf: 'high', date: '2026-11-05' },
    { field: 'bogus_field', status: 'verified', value: 'x', url: 'https://probe.example/b', kind: 'operator', quote: 'q', conf: 'high', date: '2026-11-05' },
    { field: 'operator', status: 'verified', value: 'Probe Cycling Club', url: 'https://probe.example/o', kind: 'operator', quote: 'q', conf: 'high', date: '2026-11-05' },
    { field: 'email', status: 'verified', value: 'info@probe.example', url: 'https://probe.example/e', kind: 'operator', quote: 'q', conf: 'high', date: '2026-11-05' },
  ]
  const payload = JSON.stringify([{ name: 'Constraint Probe Velodrome', cc: 'GBR', entries }])
  threw = false
  try { await c.query(`SELECT public.apply_velodrome_info('probe', $1::jsonb)`, [payload]) } catch (e) { threw = true; console.log(e.message) }
  ok('constraint violations do not abort', !threw)
  const rejected = await q(`SELECT field FROM public.track_info_apply_log WHERE batch = 'probe' AND outcome = 'field_rejected' ORDER BY field`)
  ok('each rejected field is logged', rejected.map((r) => r.field).join(',') === 'bogus_field,operating_status,phone,price_range,year_built')
  const p = (await q(`SELECT operator, email, contact_is_organisational, phone, year_built, price_min, operating_status FROM public.tracks WHERE id = $1`, [probe]))[0]
  ok('valid fields of the same track are applied', p.operator === 'Probe Cycling Club' && p.email === 'info@probe.example' && p.contact_is_organisational === true)
  ok('rejected fields left the row untouched', p.phone === null && p.year_built === null && p.price_min === null && p.operating_status === 'unknown')
  ok('rejected fields have no provenance row', (await q(`SELECT 1 FROM public.track_info_sources WHERE track_id = $1 AND field IN ('phone','year_built','price_range','operating_status')`, [probe])).length === 0)
  const probeBefore = JSON.parse(await snapshot())
  await c.query(`SELECT public.apply_velodrome_info('probe', $1::jsonb)`, [payload])
  ok('probe re-run is idempotent apart from the repeated rejection log', JSON.stringify(probeBefore.slice(0, 2)) === JSON.stringify(JSON.parse(await snapshot()).slice(0, 2)))

  // ---- a broken data migration cannot fail the pipeline (outer handler) ----
  const broken = sqls[target].replace(/\$json\$[\s\S]*?\$json\$/, `$json$"not an array"$json$`)
  threw = false
  try { await c.query(broken) } catch (e) { threw = true }
  ok('malformed data migration does not fail', !threw)
  ok('malformed data migration is logged as batch_error', (await q(`SELECT 1 FROM public.track_info_apply_log WHERE outcome = 'batch_error'`)).length >= 1)
}
