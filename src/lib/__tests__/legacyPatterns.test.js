// Run with: node --test src/lib/__tests__/legacyPatterns.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildIntervalManifest, manifestToDslInput, parseIntervalDsl, stringifyIntervalDsl } from '../intervalDsl.js'
import { evaluateTemplate } from '../templateEngine.js'
import { LEGACY_SEEDED_MANIFESTS, LEGACY_TEMPLATE_DSL } from '../systemTemplates.js'

const migration = readFileSync(new URL('../../../supabase/migrations/20261102000000_legacy_template_dsl_source.sql', import.meta.url), 'utf8')
const rep = (v, n) => new Array(n).fill(v)
const build = (dsl) => {
  const parsed = parseIntervalDsl(dsl)
  assert.deepEqual(parsed.errors, [], dsl)
  return buildIntervalManifest(parsed)
}
const stripMetrics = ({ metrics, ...rest }) => rest

test('seeded legacy DSL parses, round-trips and is stable', () => {
  for (const [slug, dsl] of Object.entries(LEGACY_TEMPLATE_DSL)) {
    const parsed = parseIntervalDsl(dsl)
    assert.deepEqual(parsed.errors, [], slug)
    assert.equal(stringifyIntervalDsl(parsed), dsl, slug)
    assert.equal(stringifyIntervalDsl(parseIntervalDsl(stringifyIntervalDsl(parsed))), dsl, slug)
  }
})

test('DSL builds the same manifest keys the seeded manifests use', () => {
  for (const [slug, dsl] of Object.entries(LEGACY_TEMPLATE_DSL)) {
    const seeded = stripMetrics(LEGACY_SEEDED_MANIFESTS[slug])
    const built = build(dsl)
    delete built.summary_metrics
    assert.deepEqual(built, seeded, slug)
  }
})

test('stored manifests convert back to the seeded DSL', () => {
  for (const [slug, manifest] of Object.entries(LEGACY_SEEDED_MANIFESTS)) {
    assert.equal(stringifyIntervalDsl(manifestToDslInput(manifest)), LEGACY_TEMPLATE_DSL[slug], slug)
  }
})

test('migration only fills dsl_source for seeded system templates and matches the catalog', () => {
  for (const [slug, dsl] of Object.entries(LEGACY_TEMPLATE_DSL)) {
    assert.ok(migration.includes(`$q$${slug}$q$`), slug)
    assert.ok(migration.includes(`$q$${dsl}$q$`), slug)
  }
  assert.match(migration, /dsl_source IS NULL/)
  assert.doesNotMatch(migration, /manifest\s*=/i)
})

// ---- equivalence on synthetic streams -------------------------------------

function burstsStream() {
  const watts = [...rep(120, 100)]
  const hr = [...rep(110, 100)]
  for (let i = 0; i < 3; i++) {
    watts.push(...rep(420 - i * 20, 180), ...rep(90, 120))
    hr.push(...rep(170 - i, 180), ...rep(140 - i * 5, 120))
  }
  return { watts, heartrate: hr, cadence: watts.map((w) => w / 4) }
}
function pursuitStream() {
  const watts = [...rep(80, 60), ...rep(450, 120), ...rep(430, 120), ...rep(80, 60)]
  return { watts, cadence: rep(105, watts.length), speed: watts.map((w) => (w > 200 ? 52 : 15)), heartrate: watts.map((w) => (w > 200 ? 170 : 100)) }
}
function f200Stream() {
  const cadence = rep(90, 120)
  const watts = rep(200, 120)
  for (let i = 55; i < 68; i++) { cadence[i] = 140 + (i === 61 ? 8 : 0); watts[i] = 1200 }
  return { watts, cadence, speed: watts.map((w) => (w > 800 ? 70 : 30)) }
}
function standingStream() {
  const torque = rep(10, 200)
  const cadence = rep(40, 200)
  const watts = rep(100, 200)
  for (let i = 20; i < 100; i++) { torque[i] = 90 + (i === 30 ? 20 : 0); watts[i] = 300 + i * 3; cadence[i] = i < 21 ? 40 : 90 }
  return { watts, torque, cadence, speed: watts.map(() => 40) }
}

const STREAMS = {
  tpl_vo2max_3min: burstsStream,
  tpl_track_f200: f200Stream,
  tpl_track_pursuit: pursuitStream,
  tpl_track_standing_start: standingStream,
  tpl_road_z2_decoupling: pursuitStream,
}

for (const slug of Object.keys(LEGACY_TEMPLATE_DSL)) {
  test(`${slug}: DSL manifest evaluates identically to the seeded manifest`, () => {
    const ts = STREAMS[slug]()
    const seeded = evaluateTemplate({ slug, manifest: LEGACY_SEEDED_MANIFESTS[slug] }, ts, 300)
    const viaDsl = evaluateTemplate({ slug, manifest: build(LEGACY_TEMPLATE_DSL[slug]) }, ts, 300)
    assert.deepEqual(viaDsl, seeded)
    assert.ok(seeded.efforts.length > 0 || slug === 'tpl_road_z2_decoupling', `${slug} should detect something`)
  })
}

test('decoupling via DSL equals the legacy metrics-list result', () => {
  const ts = pursuitStream()
  ts.heartrate = [...rep(100, 60), ...rep(150, 120), ...rep(165, 120), ...rep(100, 60)]
  const legacy = evaluateTemplate({ manifest: { pattern: 'sustained_tt', min_duration_sec: 120, metrics: ['pw_hr_decoupling_pct'] } }, ts)
  const viaDsl = evaluateTemplate({ manifest: build('pattern sustained_tt\nmin duration 2min\nmetrics decoupling') }, ts)
  assert.ok(legacy.summary.pw_hr_decoupling_pct > 0)
  assert.deepEqual(viaDsl, legacy)
})

test('legacy output is unchanged by adding nothing: manifest without options still evaluates', () => {
  for (const pattern of ['repeated_bursts', 'flying_sprint', 'sustained_tt', 'standing_start']) {
    const ts = { repeated_bursts: burstsStream, flying_sprint: f200Stream, sustained_tt: pursuitStream, standing_start: standingStream }[pattern]()
    const viaDsl = evaluateTemplate({ manifest: build(`pattern ${pattern}`) }, ts)
    const raw = evaluateTemplate({ manifest: { pattern } }, ts)
    assert.deepEqual(viaDsl, raw)
  }
})

// ---- grammar --------------------------------------------------------------

test('every pattern option parses and round-trips', () => {
  const docs = [
    'pattern repeated_bursts\ncount 5\nduration 90sec ±15sec\nrecovery window 30sec',
    'pattern repeated_bursts\ncount 4\nmetrics np, vi',
    'pattern flying_sprint\ndistance 250m',
    'pattern standing_start\ndistance 500m\nmetrics max_power',
    'pattern sustained_tt\ndistances 1.5km, 3km\nmin duration 3min\nlap 125m',
  ]
  for (const doc of docs) {
    const parsed = parseIntervalDsl(doc)
    assert.deepEqual(parsed.errors, [], doc)
    const text = stringifyIntervalDsl(parsed)
    assert.equal(stringifyIntervalDsl(parseIntervalDsl(text)), text)
    const manifest = buildIntervalManifest(parsed)
    assert.equal(stringifyIntervalDsl(manifestToDslInput(manifest)), text, doc)
  }
  // options are normalised to canonical order
  assert.equal(
    stringifyIntervalDsl(parseIntervalDsl('pattern sustained_tt\nlap 250m\nmin duration 20min')),
    'pattern sustained_tt\nmin duration 20min\nlap 250m'
  )
})

test('manifest values: units and tolerance conversion', () => {
  const m = build('pattern repeated_bursts\ncount 3\nduration 2min ±30sec\nrecovery window 90sec')
  assert.deepEqual(m, { pattern: 'repeated_bursts', target_count: 3, target_duration_sec: 120, duration_tolerance_sec: 30, recovery_window_sec: 90 })
  assert.equal(build('pattern flying_sprint\ndistance 0.2km').distance_m, 200)
})

test('pattern errors', () => {
  const err = (dsl) => parseIntervalDsl(dsl).errors.map((e) => e.message).join(' | ')
  assert.match(err('pattern nope'), /Unknown pattern/)
  assert.match(err('pattern flying_sprint\ncount 3'), /not available with pattern flying_sprint/)
  assert.match(err('pattern flying_sprint\ndistance 200m\ndistance 300m'), /Only one "distance"/)
  assert.match(err('pattern flying_sprint\ndistance 0m'), /greater than 0/)
  assert.match(err('pattern flying_sprint\nwork 3min ±10% @ best'), /only used without "pattern"/)
  assert.match(err('pattern flying_sprint\nwarmup 5min'), /not available with pattern/)
  assert.match(err('pattern sustained_tt\ndistances 2km, abc'), /Distances must look like/)
  assert.match(err('pattern repeated_bursts\nduration 3min'), /Expected duration/)
  assert.match(err('pattern repeated_bursts\nfoo'), /Pattern repeated_bursts accepts/)
  assert.match(err('2x\nwork 1min ±5% @ best\ncount 3'), /needs a first line like "pattern/)
  assert.deepEqual(parseIntervalDsl('pattern flying_sprint').errors, [])
})

test('ordinary interval templates are unaffected', () => {
  const dsl = '4x\nwork 3min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP'
  const parsed = parseIntervalDsl(dsl)
  assert.equal(parsed.pattern, null)
  assert.equal(buildIntervalManifest(parsed).pattern, 'custom_intervals')
  assert.equal(stringifyIntervalDsl(parsed), dsl)
})
