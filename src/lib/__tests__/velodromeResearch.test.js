import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decide, decideMissed, resolveTrack, evaluate, sampleApplied, sampleSize, applyGate, buildEntries, renderMigration, chunkTracks, withCoordinates,
  priceText, HOLD_TRACKS,
} from '../../../scripts/velodrome-research/lib.mjs'

const rec = (o = {}) => ({ verdict: 'verified', reason: 'Own fetch: quote found and supports value.', ...o })
const cand = (o = {}) => ({
  seed: 'T', name: 'T', country_code: 'GER', field: 'website_url', value: 'https://t.example/', source_url: 'https://t.example/',
  evidence: 'quote', confidence: 'high', source_kind: 'operator', note: null, organisational: false, extraEvidence: false,
  review: rec(), ...o,
})

test('applies a verified, high-confidence, official value', () => {
  assert.equal(decide(cand()).decision, 'apply')
})

test('rejected and unverifiable values are excluded', () => {
  assert.equal(decide(cand({ review: rec({ verdict: 'rejected' }) })).decision, 'exclude')
  assert.equal(decide(cand({ review: rec({ verdict: 'unverifiable' }) })).code, 'unverifiable')
})

test('missing review, medium confidence and non-official kinds are held', () => {
  assert.equal(decide(cand({ review: null })).code, 'not_reviewed')
  assert.equal(decide(cand({ confidence: 'medium' }), 'strict').code, 'confidence')
  assert.equal(decide(cand({ confidence: 'low' })).code, 'confidence')
  assert.equal(decide(cand({ source_kind: 'aggregator' })).code, 'source_kind')
  assert.equal(decide(cand({ source_kind: null })).code, 'source_kind')
  assert.equal(decide(cand({ source_kind: null }), 'strict').code, 'source_kind')
})

test('relaxed: medium confidence applies when verified, but never for contacts', () => {
  assert.equal(decide(cand({ confidence: 'medium' })).decision, 'apply')
  assert.equal(decide(cand({ confidence: 'medium', review: rec({ verdict: 'unverifiable' }) })).decision, 'exclude')
  const email = { field: 'email', value: 'info@t.example', confidence: 'medium', organisational: true, review: rec({ contact_is_organisational_check: 'confirmed' }) }
  assert.equal(decide(cand(email)).decision, 'hold')
})

test('relaxed: other/missing source_kind is reclassified only for official venue pages', () => {
  const lv = 'https://www.better.org.uk/leisure-centre/lee-valley/velopark/track-cycling'
  const d = decide(cand({ source_kind: null, source_url: lv }))
  assert.equal(d.decision, 'apply')
  assert.equal(d.reclassified.to, 'operator')
  assert.equal(decide(cand({ source_kind: 'other', source_url: lv })).decision, 'apply')
  assert.equal(decide(cand({ source_kind: 'other', source_url: 'https://www.better.org.uk/leisure-centre/elsewhere' })).code, 'source_kind')
  for (const u of ['https://en.wikipedia.org/wiki/Lee_Valley_VeloPark', 'https://www.visitlondon.com/x', 'https://someclub.example/track']) {
    assert.equal(decide(cand({ source_kind: 'other', source_url: u })).code, 'source_kind')
  }
})

test('relaxed: hours caveat needs scope stated in the value; price needs per-session evidence', () => {
  const hrs = (value) => cand({ field: 'opening_hours', value, review: rec({ reason: 'Verified, but the page is venue-wide and hours may differ for the velodrome.' }) })
  assert.equal(decide(hrs('Whole venue: Mon-Fri 6am-10pm (velodrome sessions may differ)')).decision, 'apply')
  assert.equal(decide(hrs('Mon-Fri 6am-10pm')).code, 'reviewer_caveat')
  assert.equal(decide(hrs('Whole venue: Mon-Fri 6am-10pm (velodrome sessions may differ)'), 'strict').code, 'reviewer_caveat')
  const price = (evidence) => cand({ field: 'price_range', value: { min: 12.25, max: 47.2, currency: 'GBP' }, confidence: 'medium', evidence })
  assert.equal(decide(price('Price: 12.25 for 60 minutes; 24.50 for 120 minutes')).decision, 'apply')
  assert.notEqual(decide(price('Club membership fee 12.25')).decision, 'apply')
})

test('reviewer caveats and reviewer fixes are held', () => {
  assert.equal(decide(cand({ review: rec({ reason: 'Verified. Needs attention: club fee.' }) })).code, 'reviewer_caveat')
  assert.equal(decide(cand({ review: rec({ value_fix: 'https://other/' }) })).code, 'reviewer_fix')
})

test('source_url_fix is used as the source and its explanation is not a caveat', () => {
  const d = decide(cand({ review: rec({ source_url_fix: 'https://t.example/fixed', reason: 'Quote does not contain the value on the cited page; it is on https://t.example/fixed.' }) }))
  assert.equal(d.decision, 'apply')
  assert.equal(d.source_url, 'https://t.example/fixed')
})

test('contacts need an organisational flag and a reviewer confirmation', () => {
  const email = { field: 'email', value: 'info@t.example' }
  assert.equal(decide(cand(email)).code, 'contact')
  assert.equal(decide(cand({ ...email, organisational: true })).code, 'contact')
  assert.equal(decide(cand({ ...email, organisational: true, review: rec({ contact_is_organisational_check: 'confirmed' }) })).decision, 'apply')
  assert.equal(decide(cand({ field: 'phone', value: 'abc', organisational: true, review: rec({ contact_is_organisational_check: 'confirmed' }) })).code, 'invalid_value')
})

test('price range must satisfy schema and be single-source', () => {
  const ok = cand({ field: 'price_range', value: { min: 5, max: 10, currency: 'EUR' } })
  assert.equal(decide(ok).decision, 'apply')
  assert.equal(decide({ ...ok, value: { min: 10, max: 5, currency: 'EUR' } }).code, 'invalid_value')
  assert.equal(decide({ ...ok, value: { min: 5, max: 10, currency: 'euro' } }).code, 'invalid_value')
  assert.equal(decide({ ...ok, extraEvidence: true }).code, 'multi_source')
  assert.equal(priceText({ min: 5, max: 5, currency: 'EUR' }), 'EUR 5')
})

test('open status must be stated, not inferred', () => {
  const s = { field: 'operating_status', value: 'open' }
  assert.equal(decide(cand({ ...s, evidence: 'Tariffs 2026' })).code, 'status_inferred')
  assert.equal(decide(cand({ ...s, evidence: 'Open daily 10am - 6pm' })).decision, 'apply')
  assert.equal(decide(cand({ field: 'year_built', value: 1700 })).code, 'invalid_value')
})

test('identity-held tracks are never applied', () => {
  for (const seed of Object.keys(HOLD_TRACKS)) assert.equal(decide(cand({ seed })).code, 'identity')
})

test('missed entries: strict criteria, corrections held', () => {
  const m = (raw, extra = {}) => ({ batch: 'b', seed: 'T', name: 'T', country_code: 'GER', reviewedDate: '2026-11-05', raw: { track: 'T', field: 'operator', value: 'City', source_url: 'https://t.example/', quote: 'City runs it', confidence: 'high', source_kind: 'owner', ...raw }, ...extra })
  assert.equal(decideMissed(m({}), new Set()).decision, 'apply')
  assert.equal(decideMissed(m({}), new Set(['T|operator'])).code, 'replaces_researcher')
  assert.equal(decideMissed(m({ quote: null }), new Set()).code, 'incomplete')
  assert.equal(decideMissed(m({ confidence: 'medium' }), new Set()).code, 'confidence')
  assert.equal(decideMissed(m({ source_kind: 'aggregator' }), new Set()).code, 'source_kind')
  assert.equal(decideMissed(m({ field: 'seed_mismatch' }), new Set()).code, 'not_a_field')
  assert.equal(decideMissed(m({ field: 'phone', value: '+49 1234 5678' }), new Set()).decision, 'hold')
})

test('track names resolve through aliases and unknown names throw', () => {
  const names = new Set(['Aarhus Cyklebane'])
  assert.equal(resolveTrack('Aarhus Cykelbane', names), 'Aarhus Cyklebane')
  assert.throws(() => resolveTrack('Nowhere', names), /Unresolved/)
})

const input = (research, review) => [{ batch: 'b', research: { tracks: research }, review: { reviewed_at: '2026-11-05', records: review, missed_info: [] } }]
const track = (seed_name, fields) => ({ seed_name, seed_values: { country_code: 'GER' }, fields, operating_status: null, not_found: [] })
const f = (value) => ({ value, source_url: 'https://t.example/', evidence: 'q', confidence: 'high', source_kind: 'operator' })

test('evaluate: duplicate equal values collapse, differing values conflict', () => {
  const r = (v) => ({ track: 'T', kind: 'field', field: 'operator', proposed_value: v, verdict: 'verified', reason: 'ok' })
  const same = evaluate([...input([track('T', { operator: f('City') })], [r('City')]), ...input([track('T', { operator: f('City') })], [r('City')])])
  assert.deepEqual(same.items.map((i) => i.decision).sort(), ['apply', 'duplicate'])
  const diff = evaluate([...input([track('T', { operator: f('City') })], [r('City')]), ...input([track('T', { operator: f('Club') })], [r('Club')])])
  assert.ok(diff.items.every((i) => i.code === 'conflict'))
})

test('relaxed sampling uses a higher rate with a minimum of 5', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ batch: 'a', name: `N${i}`, field: 'operator' }))
  assert.equal(sampleApplied(items, 'seed', { rate: 0.2, min: 5 }).a.length, 8)
  assert.equal(sampleApplied(items.slice(0, 10), 'seed', { rate: 0.2, min: 5 }).a.length, 5)
  assert.equal(sampleApplied(items.slice(0, 3), 'seed', { rate: 0.2, min: 5 }).a.length, 3)
})

test('sampling is deterministic, at least 3 and about 10% per batch', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ batch: i < 40 ? 'a' : 'b', name: `N${i}`, field: 'operator' }))
  const s1 = sampleApplied(items, 'seed')
  assert.deepEqual(s1, sampleApplied(items, 'seed'))
  assert.equal(s1.a.length, 4)
  assert.equal(s1.b.length, 3)
  assert.equal(sampleSize(2), 2)
  assert.equal(sampleSize(0), 0)
})

test('gate: >5% failures halt the batch, otherwise only failures are held', () => {
  const mk = () => [{ batch: 'a', name: 'X', field: 'operator', decision: 'apply' }, { batch: 'a', name: 'Y', field: 'operator', decision: 'apply' }, { batch: 'b', name: 'Z', field: 'operator', decision: 'apply' }]
  const items = mk()
  applyGate(items, [{ batch: 'a', name: 'X', field: 'operator', result: 'fail' }, { batch: 'a', name: 'Y', field: 'operator', result: 'pass' }])
  assert.deepEqual(items.map((i) => i.code), ['batch_halted', 'batch_halted', undefined])
  const items2 = mk()
  const results = Array.from({ length: 20 }, (_, i) => ({ batch: 'a', name: i ? `P${i}` : 'X', field: 'operator', result: i ? 'pass' : 'fail' }))
  applyGate(items2, results)
  assert.equal(items2[0].code, 'spot_check_failed') // 1/20 = 5% is not above 5%
  assert.equal(items2[1].code, undefined)
})

test('migration SQL delegates to the tolerant applier and cannot fail the pipeline', () => {
  const items = [{ decision: 'apply', code: 'apply', name: 'T', country_code: 'GER', field: 'phone', value_text: '+49 1234 5678', source_url: 'https://t.example/', evidence: 'q', confidence: 'high', source_kind: 'operator', reviewedDate: '2026-11-05' }]
  const tracks = buildEntries(items, [{ name: 'T', country_code: 'GER', seed: 'T', field: 'email', reviewedDate: '2026-11-05' }])
  assert.deepEqual(tracks[0].entries.map((e) => `${e.field}:${e.status}`), ['email:not_found', 'phone:verified'])
  const sql = renderMigration(tracks, '-- h', 'strict-01')
  assert.match(sql, /PERFORM public\.apply_velodrome_info\('strict-01', \$json\$/)
  assert.match(sql, /EXCEPTION WHEN OTHERS THEN/)
  assert.match(sql, /'batch_error'/)
  assert.doesNotMatch(sql, /RAISE EXCEPTION/)
  assert.throws(() => renderMigration([{ name: '$json$' }], '', 'x'), /dollar-quote/)
  assert.throws(() => renderMigration([], '', "x'; DROP"), /Invalid batch id/)
})

test('chunkTracks keeps chunks small and independent, withCoordinates adds seed coordinates', () => {
  const mk = (n, pad = 0) => ({ name: `T${n}`, cc: 'GBR', entries: [{ field: 'operator', status: 'verified', value: 'x'.repeat(pad) }] })
  const tracks = Array.from({ length: 45 }, (_, i) => mk(i))
  const chunks = chunkTracks(tracks)
  assert.deepEqual(chunks.map((c) => c.length), [20, 20, 5])
  assert.deepEqual(chunks.flat(), tracks)
  const big = chunkTracks(Array.from({ length: 4 }, (_, i) => mk(i, 12000)), { maxBytes: 30000 })
  assert.ok(big.length >= 2 && big.every((c) => c.length >= 1))
  const [t] = withCoordinates([mk(1)], { 'T1|GBR': [51.5, -0.1] })
  assert.equal(t.lat, 51.5)
  assert.equal(t.lon, -0.1)
  assert.equal(withCoordinates([mk(2)], {})[0].lat, undefined)
})
