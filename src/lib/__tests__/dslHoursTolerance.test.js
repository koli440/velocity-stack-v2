// Run with: node --test src/lib/__tests__/dslHoursTolerance.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIntervalManifest, parseIntervalDsl, stringifyIntervalDsl } from '../intervalDsl.js'
import { parseStructure } from '../plannedWorkouts.js'
import { buildPreview } from '../workoutPreview.js'
import { manifestToIntervalsText } from '../intervalsWorkout.js'

const step = (line) => parseIntervalDsl(line).steps[0]

test('hour units convert to seconds', () => {
  for (const u of ['h', 'hr', 'hrs', 'hour', 'hours', 'H', 'Hours']) {
    const p = parseIntervalDsl(`work 2${u} @ Z2`)
    assert.deepEqual(p.errors, [], u)
    assert.equal(p.steps[0].targetDurationSec, 7200)
    assert.equal(p.steps[0].keyBy, 'duration')
  }
  assert.equal(step('work 1.5h @ Z2').targetDurationSec, 5400)
  assert.equal(step('work 2 h @ Z2').targetDurationSec, 7200)
  assert.equal(step('work 2h ±5% @ Z2').durationTolerancePct, 5)
  assert.equal(step('recovery 0.5h @ <Z2').targetDurationSec, 1800)
})

test('existing units are unchanged: m metres, min minutes, s seconds', () => {
  assert.equal(step('work 5m @ best speed').targetDistanceM, 5)
  assert.equal(step('work 5min @ Z3').targetDurationSec, 300)
  assert.equal(step('work 5s @ Z3').targetDurationSec, 5)
  assert.equal(step('work 5sec @ Z3').targetDurationSec, 5)
  assert.equal(step('work 5km @ best power').targetDistanceM, 5000)
})

test('zero hours is rejected', () => {
  assert.ok(parseIntervalDsl('work 0h @ Z2').errors.length)
})

test('warmup and cooldown accept hours', () => {
  const p = parseIntervalDsl('warmup 1h\ncooldown 0.5hr\nwork 10min @ Z3')
  assert.deepEqual(p.errors, [])
  assert.equal(p.warmupSec, 3600)
  assert.equal(p.cooldownSec, 1800)
})

test('tolerance is optional and defaults to ±0%', () => {
  const a = parseIntervalDsl('work 15min @ Z3')
  const b = parseIntervalDsl('work 15min ±0% @ Z3')
  assert.deepEqual(a.errors, [])
  assert.deepEqual(a, b)
  assert.equal(a.steps[0].durationTolerancePct, 0)
  assert.deepEqual(buildIntervalManifest(a), buildIntervalManifest(b))
})

test('missing tolerance works with every band kind, sets, then and groups', () => {
  const cases = {
    'work 10min @ 90-110%FTP': { powerMin: 90, powerMax: 110 },
    'work 10min @ <55%FTP': { powerMin: null, powerMax: 55 },
    'work 10min @ best': { bandType: 'best' },
    'work 1km @ best power': { bandType: 'best', keyBy: 'distance' },
    'work 10min @ Z2-Z3': { bandType: 'zone', powerMin: 2, powerMax: 3 },
  }
  for (const [line, want] of Object.entries(cases)) {
    const p = parseIntervalDsl(line)
    assert.deepEqual(p.errors, [], line)
    assert.equal(p.steps[0].durationTolerancePct, 0)
    assert.deepEqual(p.steps[0], parseIntervalDsl(line.replace(/ (\d+(?:\.\d+)?(?:min|km)) @/, ' $1 ±0% @')).steps[0])
    for (const [k, v] of Object.entries(want)) assert.equal(p.steps[0][k], v, `${line} ${k}`)
  }
  const sets = parseIntervalDsl('3 sets of 2x\nwork 1min @ Z5\nthen work 1min @ Z4\nrecovery 1min @ <Z2\nset recovery 5min @ <Z2')
  assert.deepEqual(sets.errors, [])
  assert.equal(sets.setRecovery.durationTolerancePct, 0)
  assert.equal(sets.steps[1].contiguous, true)
  const grp = parseIntervalDsl('work 5min @ Z2\n2x\nwork 1min @ Z5\nrecovery 1min @ Z1\nend')
  assert.deepEqual(grp.errors, [])
})

test('bare watts keep their own ±5% band, independent of the tolerance', () => {
  for (const line of ['work 5min @ 50W', 'work 5min ±0% @ 50W', 'work 5min ±20% @ 50W']) {
    const s = step(line)
    assert.equal(s.powerMin, 47.5)
    assert.equal(s.powerMax, 52.5)
  }
  assert.equal(step('work 5min @ 50W').durationTolerancePct, 0)
  assert.equal(step('work 5min ±20% @ 50W').durationTolerancePct, 20)
})

test('explicit tolerances are unchanged, bad ones still fail', () => {
  assert.equal(step('work 3min ±30% @ 90-110%FTP').durationTolerancePct, 30)
  assert.equal(step('work 3min ± 7.5 % @ Z3').durationTolerancePct, 7.5)
  assert.ok(parseIntervalDsl('work 3min ±101% @ Z3').errors.length)
  assert.ok(parseIntervalDsl('work 3min ±% @ Z3').errors.length)
  assert.ok(parseIntervalDsl('work 3min 5% @ Z3').errors.length)
  assert.ok(parseIntervalDsl('work 3min @').errors.length)
})

test('legacy documents parse identically and stringify to the same text', () => {
  const dsl = '4x\nwarmup 15min\nwork 3min ±30% @ 90-110%FTP\nthen work 1km ±5% @ best power\nrecovery 2min ±50% @ <55%FTP'
  const text = stringifyIntervalDsl(parseIntervalDsl(dsl))
  assert.equal(text, dsl)
  const manifest = buildIntervalManifest(parseIntervalDsl(dsl))
  assert.equal(manifest.steps[0].durationTolerancePct, 30)
  assert.equal(manifest.warmup_sec, 900)
})

test('stringify of an omitted tolerance writes ±0% and round-trips', () => {
  const p = parseIntervalDsl('work 2h @ Z2')
  const text = stringifyIntervalDsl(p)
  assert.equal(text, '1x\nwork 120min ±0% @ Z2')
  assert.deepEqual(parseIntervalDsl(text).steps, p.steps)
})

test('planned workout validation, preview and Intervals.icu stay consistent', () => {
  const st = parseStructure('warmup 10min\nwork 2h @ Z2\nrecovery 10min @ <Z2')
  assert.deepEqual(st.errors, [])
  const same = parseStructure('warmup 10min\nwork 2h ±0% @ Z2\nrecovery 10min ±0% @ <Z2')
  assert.deepEqual(st.manifest, same.manifest)
  const preview = buildPreview(st.manifest, { ftp: 250 })
  assert.equal(preview.durationS, 600 + 7200 + 600)
  assert.equal(manifestToIntervalsText(st.manifest).text, manifestToIntervalsText(same.manifest).text)
  assert.match(manifestToIntervalsText(st.manifest).text, /Work 120m/)
  assert.ok(parseStructure('work 2x @ Z2').errors.length)
})
