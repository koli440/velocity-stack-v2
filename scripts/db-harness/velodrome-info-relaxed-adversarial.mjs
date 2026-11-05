// Velodrome info data migration relaxed-rules delta (20270137000000_velodrome_info_relaxed.sql). Run with harness.mjs, see README.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }
// MIG overrides the path when this file is copied out of the repo (see README)
const MIG = process.env.MIG || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations/20270137000000_velodrome_info_relaxed.sql')

export async function run(c) {
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  const q = async (sql, p = []) => (await c.query(sql, p)).rows
  const sql = fs.readFileSync(MIG, 'utf8')
  const snapshot = async () => JSON.stringify([
    await q(`SELECT id, website_url, booking_url, pricing_url, operator, year_built, phone, email, opening_hours, price_min, price_max, price_currency, operating_status, contact_is_organisational, notes FROM public.tracks ORDER BY id`),
    await q(`SELECT track_id, field, status, value, source_url, is_current FROM public.track_info_sources ORDER BY track_id, field, id`),
  ])

  const verified = (await q(`SELECT count(*)::int AS n FROM public.track_info_sources WHERE status = 'verified' AND is_current`))[0].n
  ok('migration inserted verified rows', verified > 100)
  const lv = (await q(`SELECT website_url, booking_url, pricing_url, operator, opening_hours, price_min, price_max, price_currency FROM public.tracks WHERE name ILIKE '%Lee Valley VeloPark%' AND country_code = 'GBR'`))
  ok('Lee Valley VeloPark exists once', lv.length === 1)
  ok('Lee Valley gets all six values', ['website_url', 'booking_url', 'pricing_url', 'operator', 'opening_hours', 'price_min', 'price_max', 'price_currency'].every((k) => lv[0][k] != null))
  ok('Lee Valley hours state their scope', /^Whole venue:/.test(lv[0].opening_hours))
  ok('Lee Valley price is GBP 12.25-47.2', Number(lv[0].price_min) === 12.25 && Number(lv[0].price_max) === 47.2 && lv[0].price_currency === 'GBP')
  ok('no relaxed value comes from wikipedia/aggregators', (await q(`SELECT 1 FROM public.track_info_sources WHERE is_current AND status = 'verified' AND source_url ~* '(wikipedia|facebook|tripadvisor|yelp)'`)).length === 0)
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

  const before = await snapshot()
  await c.query(sql)
  ok('re-running the migration is a no-op (idempotent)', (await snapshot()) === before)

  // fill-only (Lee Valley website_url is part of this delta): a differing manual value must survive and be recorded as needs_attention
  const row = (await q(`SELECT t.id, t.website_url, s.id AS sid FROM public.tracks t JOIN public.track_info_sources s ON s.track_id = t.id AND s.field = 'website_url' AND s.is_current AND s.status = 'verified' WHERE t.name ILIKE '%Lee Valley VeloPark%' LIMIT 1`))[0]
  await c.query(`UPDATE public.tracks SET website_url = 'https://manual.example/' WHERE id = $1`, [row.id])
  await c.query(`DELETE FROM public.track_info_sources WHERE id = $1`, [row.sid])
  await c.query(sql)
  ok('fill-only keeps the existing different value', (await q(`SELECT website_url FROM public.tracks WHERE id = $1`, [row.id]))[0].website_url === 'https://manual.example/')
  ok('conflict recorded as needs_attention', (await q(`SELECT 1 FROM public.track_info_sources WHERE track_id = $1 AND field = 'website_url' AND is_current AND status = 'needs_attention'`, [row.id])).length === 1)

  // exactly-one-match: an unknown or ambiguous name fails loudly
  let failed = false
  try { await c.query(sql.replace(/"name": "[^"]+"/, '"name": "No Such Velodrome"')) } catch (e) { failed = /matched 0 tracks rows/.test(e.message) }
  ok('unmatched track fails loudly', failed)
  await c.query(`DROP INDEX IF EXISTS public.tracks_name_uq`) // only present when the stub DB adds unique(name) so the v1 import applies
  await c.query(`INSERT INTO public.tracks (name, country_code, length_m, surface, is_indoor) SELECT name, country_code, length_m, surface, is_indoor FROM public.tracks WHERE id = $1`, [row.id])
  failed = false
  try { await c.query(sql) } catch (e) { failed = /matched 2 tracks rows/.test(e.message) }
  ok('ambiguous track fails loudly', failed)
}
