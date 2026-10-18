// Run with: node --test src/lib/__tests__/dslNesting.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIntervalManifest, manifestToDslInput, parseIntervalDsl, stringifyIntervalDsl } from '../intervalDsl.js'
import { parseStructure, summarizeStructure } from '../plannedWorkouts.js'
import { buildPreview } from '../workoutPreview.js'
import { buildIntervalsEvent, manifestToIntervalsText } from '../intervalsWorkout.js'

const EXAMPLE_1 = `recovery 20min ±0% @ Z1

6x
work 40s ±0% @ Z5
Recovery 20s ±0% @ 50W

recovery 10min ±0% @ Z1

6x
work 40s ±0% @ Z5
recovery 20s ±0% @ 50W

recovery 10min ±0% @ Z2`

const EXAMPLE_2 = `work 15min ±0% @ Z3
recovery 8min ±0% @ <Z3
work 15min ±0% @ Z3
recovery 8min ±0% @ <Z3
work 15min ±0% @ Z3`

test('plain step list without a repeat line is a single 1x run', () => {
  const p = parseIntervalDsl(EXAMPLE_2)
  assert.deepEqual(p.errors, [])
  assert.equal(p.repeatCount, 1)
  assert.equal(p.steps.length, 5)
  assert.equal(p.structure, null)
  assert.equal(buildIntervalManifest(p).repeat_count, 1)
})

test('explicit 1x gives the same steps as the plain list', () => {
  const a = parseIntervalDsl(EXAMPLE_2)
  const b = parseIntervalDsl(`1x\n${EXAMPLE_2}`)
  assert.deepEqual(a.steps, b.steps)
  assert.deepEqual(buildIntervalManifest(a), buildIntervalManifest(b))
})

test('repeated groups ended by blank lines (issue example)', () => {
  const p = parseIntervalDsl(EXAMPLE_1)
  assert.deepEqual(p.errors, [])
  // 1 + 6*2 + 1 + 6*2 + 1
  assert.equal(p.steps.length, 27)
  assert.equal(p.steps[0].targetDurationSec, 1200)
  assert.equal(p.steps[1].targetDurationSec, 40)
  assert.equal(p.steps[2].role, 'recovery') // case-insensitive
  assert.equal(p.steps[2].bandType, 'watts')
  assert.equal(p.steps[2].powerMin, 47.5)
  assert.equal(p.steps[2].powerMax, 52.5)
  assert.equal(p.steps.at(-1).targetDurationSec, 600) // "10min" is minutes
  assert.equal(p.steps.at(-1).keyBy, 'duration')
  assert.equal(p.structure.length, 5)
  assert.equal(p.structure[1].repeat, 6)
})

test('m is always metres; min/sec unit aliases', () => {
  const p = parseIntervalDsl('1x\nwork 200m ±10% @ best speed\nwork 90 mins ±0% @ Z2\nwork 30 secs ±0% @ Z2\nwork 5s ±0% @ Z2')
  assert.deepEqual(p.errors, [])
  assert.equal(p.steps[0].keyBy, 'distance')
  assert.equal(p.steps[0].targetDistanceM, 200)
  assert.equal(parseIntervalDsl('1x\nwork 10m ±0% @ best speed').steps[0].keyBy, 'distance')
  assert.equal(p.steps[1].targetDurationSec, 5400)
  assert.equal(p.steps[2].targetDurationSec, 30)
  assert.equal(p.steps[3].targetDurationSec, 5)
})

test('nested groups with end', () => {
  const dsl = '1x\nwork 10min ±10% @ Z3\n2x\nwork 1min ±5% @ Z5\n3x\nrecovery 10sec ±5% @ <Z2\nend\nend\nrecovery 5min ±30% @ <Z2'
  const p = parseIntervalDsl(dsl)
  assert.deepEqual(p.errors, [])
  assert.equal(p.steps.length, 1 + 2 * (1 + 3) + 1)
  assert.equal(p.repeatCount, 1)
  const again = parseIntervalDsl(stringifyIntervalDsl(manifestToDslInput(buildIntervalManifest(p))))
  assert.deepEqual(again.errors, [])
  assert.deepEqual(again.steps, p.steps)
  assert.deepEqual(again.structure, p.structure)
})

test('a leading Nx still repeats the whole description (blank lines do not end it)', () => {
  const p = parseIntervalDsl('4x\nwork 3min ±30% @ 90-110%FTP\n\nrecovery 2min ±50% @ <55%FTP')
  assert.deepEqual(p.errors, [])
  assert.equal(p.repeatCount, 4)
  assert.equal(p.steps.length, 2)
  assert.equal(p.structure, null)
})

test('group inside a leading repeat keeps repeat_count and expands per repeat', () => {
  const p = parseIntervalDsl('3x\nwork 10min ±10% @ Z3\n2x\nwork 1min ±5% @ Z5\nend\nrecovery 5min ±30% @ <Z2')
  assert.deepEqual(p.errors, [])
  assert.equal(p.repeatCount, 3)
  assert.equal(p.steps.length, 4)
})

test('validation errors: depth, empty group, stray end, sets, limits', () => {
  const deep = parseIntervalDsl('1x\n2x\n2x\n2x\n2x\nwork 1min ±5% @ Z3')
  assert.ok(deep.errors.some((e) => e.line === 5 && /nested at most 3/.test(e.message)))
  const ok3 = parseIntervalDsl('1x\n2x\n2x\n2x\nwork 1min ±5% @ Z3')
  assert.deepEqual(ok3.errors, [])

  const empty = parseIntervalDsl('work 1min ±5% @ Z3\n2x\n\nrecovery 1min ±5% @ Z1')
  assert.ok(empty.errors.some((e) => e.line === 2 && /no steps/.test(e.message)))

  const stray = parseIntervalDsl('work 1min ±5% @ Z3\nend')
  assert.ok(stray.errors.some((e) => e.line === 2 && /"end"/.test(e.message)))

  const sets = parseIntervalDsl('work 1min ±5% @ Z3\n2 sets of 3x\nwork 1min ±5% @ Z3')
  assert.ok(sets.errors.some((e) => e.line === 2 && /first line/.test(e.message)))

  assert.ok(parseIntervalDsl('work 1min ±5% @ Z3\n0x\nwork 1min ±5% @ Z3').errors.some((e) => e.line === 2))
  assert.ok(parseIntervalDsl('work 1min ±5% @ Z3\n101x\nwork 1min ±5% @ Z3').errors.some((e) => e.line === 2 && /at most 100/.test(e.message)))
  const big = parseIntervalDsl('work 1min ±5% @ Z3\n100x\nwork 1min ±5% @ Z3\n3x\nwork 1min ±5% @ Z3')
  assert.ok(big.errors.some((e) => /limit is 200/.test(e.message)))
  assert.ok(parseIntervalDsl('then work 1min ±5% @ Z3').errors.some((e) => e.line === 1))
  assert.ok(parseIntervalDsl('four times\nwork 1min ±5% @ Z3').errors.some((e) => e.line === 1))
})

test('regression: existing explicit syntax is unchanged', () => {
  const p = parseIntervalDsl('3 sets of 5x\nwarmup 10min\nwork 30sec ±20% @ 120-140%FTP\nrecovery 30sec ±50% @ <55%FTP\nset recovery 5min ±30% @ <55%FTP\nmetrics np')
  assert.deepEqual(p.errors, [])
  assert.equal(p.setCount, 3)
  assert.equal(p.repeatCount, 5)
  assert.equal(p.steps.length, 2)
  const m = buildIntervalManifest(p)
  assert.equal('structure' in m, false)
  assert.equal(m.repeat_count, 5)
  assert.equal(stringifyIntervalDsl(manifestToDslInput(m)), '3 sets of 5x\nwarmup 10min\nwork 30sec ±20% @ 120-140%FTP\nrecovery 30sec ±50% @ <55%FTP\nset recovery 5min ±30% @ <55%FTP\nmetrics np')
})

test('workout preview, summary and parseStructure use the expanded structure', () => {
  const st = parseStructure(EXAMPLE_1)
  assert.deepEqual(st.errors, [])
  const preview = buildPreview(st.manifest, { ftp: 250 })
  assert.equal(preview.durationS, 1200 + 6 * 60 + 600 + 6 * 60 + 600)
  const summary = summarizeStructure(st.manifest)
  assert.equal(summary.durationS, preview.durationS)
  assert.ok(summary.lines.includes('6x'))
  assert.ok(summary.lines.includes('  Work 40sec @ Z5'))
  assert.ok(!summary.lines.includes('1x'))
})

test('Intervals.icu converter writes top-level groups as Nx sections', () => {
  const st = parseStructure(EXAMPLE_1)
  const r = manifestToIntervalsText(st.manifest)
  const blocks = r.text.split('\n\n')
  assert.equal(blocks.length, 5)
  assert.match(blocks[1], /^Main set 6x\n- Work 40s/)
  assert.equal(blocks[1].split('\n').length, 3)
  assert.equal(blocks[0].split('\n').length, 2)

  const nested = parseStructure('work 5min ±0% @ Z2\n2x\nwork 1min ±0% @ Z5\n2x\nrecovery 10s ±0% @ Z1\nend\nend')
  const t = manifestToIntervalsText(nested.manifest).text
  assert.match(t, /Main set 2x\n- Work 1m[^\n]*\n- Recovery 10s[^\n]*\n- Recovery 10s/)

  const ev = buildIntervalsEvent({ workout_date: '2026-10-20', title: 'x', structure_dsl: EXAMPLE_2 })
  assert.equal(ev.structured, true)
  assert.equal((ev.event.description.match(/^- /gm) || []).length, 5)
})
