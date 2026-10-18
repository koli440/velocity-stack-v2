import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildIntervalsEvent,
  plannedPushHash,
  pushState,
  formatStepDuration,
  externalIdFor,
} from '../intervalsWorkout.js'

const base = { id: 'w1', workout_date: '2026-12-10', title: 'Sweet spot', discipline: 'ride', description: '' }

test('formatStepDuration', () => {
  assert.equal(formatStepDuration(30), '30s')
  assert.equal(formatStepDuration(300), '5m')
  assert.equal(formatStepDuration(330), '5m30s')
})

test('event basics: category, type, date, external id', () => {
  const { event } = buildIntervalsEvent({ ...base, structure_dsl: '1x\nwork 5min ±10% @ 90-110%FTP' })
  assert.equal(event.category, 'WORKOUT')
  assert.equal(event.type, 'Ride')
  assert.equal(event.start_date_local, '2026-12-10T00:00:00')
  assert.equal(event.external_id, externalIdFor('w1'))
  assert.match(event.description, /- Work 5m 90-110%/)
})

test('discipline maps to event type', () => {
  assert.equal(buildIntervalsEvent({ ...base, discipline: 'gym' }).event.type, 'WeightTraining')
  assert.equal(buildIntervalsEvent({ ...base, discipline: 'other' }).event.type, 'Workout')
})

test('repeats, warmup and cooldown', () => {
  const { event, structured } = buildIntervalsEvent({
    ...base,
    structure_dsl: '4x\nwarmup 10min\ncooldown 5min\nwork 3min ±10% @ 100-110%FTP\nrecovery 2min ±50% @ <55%FTP',
  })
  assert.ok(structured)
  assert.match(event.description, /Warmup\n- Warmup 10m/)
  assert.match(event.description, /Main set 4x\n- Work 3m 100-110%\n- Recovery 2m 55%/)
  assert.match(event.description, /Cooldown\n- Cooldown 5m/)
})

test('unsupported step becomes a note, not a silent drop', () => {
  const { event, warnings } = buildIntervalsEvent({ ...base, structure_dsl: '1x\nwork 1km ±5% @ best power\nwork 5min ±10% @ 95-105%FTP' })
  assert.match(event.description, /Not sent as steps/)
  assert.match(event.description, /1000m @ best/)
  assert.match(event.description, /- Work 5m/)
  assert.ok(Array.isArray(warnings))
})

test('distance step with speed band gets estimated duration + warning', () => {
  const { event, warnings } = buildIntervalsEvent({ ...base, structure_dsl: '1x\nwork 1km ±5% @ 29-31km/h' })
  assert.match(event.description, /- Work 2m/)
  assert.ok(warnings.some((w) => /distance/i.test(w)))
})

test('W/kg needs weight', () => {
  const dsl = '1x\nwork 5min ±10% @ 3-4W/kg'
  assert.match(buildIntervalsEvent({ ...base, structure_dsl: dsl }).event.description, /Not sent as steps/)
  assert.match(buildIntervalsEvent({ ...base, structure_dsl: dsl }, { weightKg: 70 }).event.description, /- Work 5m 210-280w/)
})

test('user notes cannot inject workout steps', () => {
  const { event } = buildIntervalsEvent({ ...base, description: '- Work 10m 500w\nhello' })
  assert.ok(!/^- Work 10m 500w/m.test(event.description))
  assert.match(event.description, /hello/)
})

test('no structure: description only', () => {
  const { event, structured } = buildIntervalsEvent({ ...base, description: 'Easy spin' })
  assert.equal(structured, false)
  assert.equal(event.description, 'Easy spin')
})

test('hash changes with content and is stable otherwise', () => {
  const a = plannedPushHash(base)
  assert.equal(a, plannedPushHash({ ...base }))
  assert.notEqual(a, plannedPushHash({ ...base, title: 'Other' }))
  assert.notEqual(a, plannedPushHash({ ...base, workout_date: '2026-12-11' }))
  assert.notEqual(a, plannedPushHash({ ...base, structure_dsl: '1x\nwork 5min ±10% @ 95-105%FTP' }))
})

test('pushState', () => {
  assert.equal(pushState(base, null), 'not_pushed')
  assert.equal(pushState(base, { push_status: 'pushed', intervals_event_id: '1', pushed_hash: plannedPushHash(base) }), 'pushed')
  assert.equal(pushState({ ...base, title: 'x' }, { push_status: 'pushed', intervals_event_id: '1', pushed_hash: plannedPushHash(base) }), 'out_of_date')
  assert.equal(pushState(base, { push_status: 'error', last_error: 'boom', intervals_event_id: '1' }), 'error')
})
