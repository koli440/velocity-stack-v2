import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWahooWorkout, wahooDayCode, wahooWorkoutFields, planFileDataUri, wahooPushHash, wahooPushState, intervalsSeconds, wahooExternalId } from '../wahooPlan.js'

const wk = (over = {}) => ({ id: 'w1', rider_id: 'r1', workout_date: '2027-01-12', discipline: 'ride', title: 'Sweet spot', description: '', structure_dsl: null, structure_manifest: null, status: 'planned', ...over })
const withManifest = (manifest, over = {}) => wk({ structure_manifest: manifest, ...over })
const step = (over = {}) => ({ role: 'work', keyBy: 'time', targetDurationSec: 600, bandType: 'pct_ftp', powerMin: 88, powerMax: 94, ...over })

test('day code counts days since 2020-01-01', () => {
  assert.equal(wahooDayCode('2020-01-01'), 0)
  assert.equal(wahooDayCode('2020-01-02'), 1)
  assert.equal(wahooDayCode('2021-01-01'), 366)
})

test('workout without steps is scheduled without a plan and defaults to 60 minutes', () => {
  const r = buildWahooWorkout(wk(), { ftp: 250 })
  assert.equal(r.plan, null)
  assert.equal(r.minutes, 60)
  assert.equal(r.structured, false)
})

test('fixed pattern without steps is scheduled without a plan and warns', () => {
  const r = buildWahooWorkout(withManifest({ pattern: 'flying_lap' }))
  assert.equal(r.plan, null)
  assert.ok(r.warnings.some((w) => /flying lap/.test(w)))
})

test('steps become a plan with ftp targets, warmup/cooldown and a repeat block', () => {
  const r = buildWahooWorkout(withManifest({ warmup_sec: 600, cooldown_sec: 300, repeat_count: 3, steps: [step(), step({ role: 'recovery', targetDurationSec: 120, powerMin: 50, powerMax: 55 })] }), { ftp: 250 })
  assert.equal(r.plan.header.ftp, 250)
  assert.equal(r.plan.header.version, '1.0.0')
  const [wu, main, cd] = r.plan.intervals
  assert.equal(wu.intensity_type, 'wu')
  assert.equal(cd.intensity_type, 'cd')
  assert.equal(main.exit_trigger_type, 'repeat')
  assert.equal(main.exit_trigger_value, 2) // N additional iterations
  assert.deepEqual(main.intervals[0].targets, [{ type: 'ftp', low: 0.88, high: 0.94 }])
  assert.equal(main.intervals[1].intensity_type, 'recover')
  assert.equal(r.minutes, Math.round((600 + 300 + 3 * 720) / 60))
  assert.equal(intervalsSeconds(r.plan.intervals), 600 + 300 + 3 * 720)
})

test('absolute targets: watts, rpm, hr and speed in m/s', () => {
  const kinds = [['watts', 200, 220], ['cadence_rpm', 90, 95], ['hr_bpm', 140, 150], ['speed_kmh', 36, 36]]
  const r = buildWahooWorkout(withManifest({ steps: kinds.map(([bandType, powerMin, powerMax]) => step({ bandType, powerMin, powerMax })) }))
  assert.deepEqual(r.plan.intervals.map((i) => i.targets[0].type), ['watts', 'rpm', 'hr', 'speed'])
  assert.equal(r.plan.intervals[3].targets[0].low, 10)
})

test('missing FTP keeps the duration, drops the target and warns', () => {
  const r = buildWahooWorkout(withManifest({ steps: [step()] }), { ftp: null })
  assert.equal(r.plan.intervals[0].targets, undefined)
  assert.equal(r.plan.header.ftp, undefined)
  assert.ok(r.warnings.some((w) => /FTP/.test(w)))
})

test('LT2 and unsupported bands warn instead of dropping silently', () => {
  const r = buildWahooWorkout(withManifest({ steps: [step({ bandType: 'pct_lt2' }), step({ bandType: 'w_per_kg', powerMin: 3, powerMax: 3 })] }), { ftp: 250 })
  assert.equal(r.plan.intervals[0].targets[0].type, 'ftp')
  assert.equal(r.plan.intervals[1].targets, undefined)
  assert.ok(r.warnings.length >= 2)
})

test('distance steps use the distance trigger', () => {
  const r = buildWahooWorkout(withManifest({ steps: [step({ keyBy: 'distance', targetDistanceM: 5000, targetDurationSec: 0 })] }), { ftp: 250 })
  assert.equal(r.plan.intervals[0].exit_trigger_type, 'distance')
  assert.equal(r.plan.intervals[0].exit_trigger_value, 5000)
})

test('workout fields schedule the day and reference the plan', () => {
  const f = wahooWorkoutFields(wk(), { minutes: 45, planId: '9' })
  assert.equal(f['workout[starts]'], '2027-01-12T12:00:00.000Z')
  assert.equal(f['workout[day_code]'], String(wahooDayCode('2027-01-12')))
  assert.equal(f['workout[plan_id]'], '9')
  assert.equal(f['workout[workout_token]'], 'w1')
  assert.equal(wahooWorkoutFields(wk(), { minutes: 45 })['workout[plan_id]'], undefined)
})

test('plan file is a base64 JSON data URI', () => {
  const uri = planFileDataUri({ a: 1 })
  assert.match(uri, /^data:application\/json;base64,/)
  assert.deepEqual(JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString()), { a: 1 })
  assert.equal(wahooExternalId('w1'), 'velocity-stack:w1')
})

test('push hash and state follow edits', () => {
  const w = wk()
  const row = { wahoo_workout_id: '5', pushed_hash: wahooPushHash(w), push_status: 'pushed' }
  assert.equal(wahooPushState(w, null), 'not_pushed')
  assert.equal(wahooPushState(w, row), 'pushed')
  assert.equal(wahooPushState(wk({ title: 'Other' }), row), 'out_of_date')
  assert.equal(wahooPushState(w, { ...row, push_status: 'error', last_error: 'x' }), 'error')
})
