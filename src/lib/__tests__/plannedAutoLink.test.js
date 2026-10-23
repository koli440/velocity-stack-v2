import test from 'node:test'
import assert from 'node:assert/strict'
import { pickAutoLinkCandidate, autoLinkActivity, localDayOf, dayOfLocalStamp, activityDiscipline } from '../plannedWorkouts.js'

const DAY = '2026-10-23'
let n = 0
const W = (o = {}) => ({
  id: `w${++n}`, rider_id: 'r', workout_date: DAY, discipline: 'ride', title: 'Ride', status: 'planned', activity_id: null,
  auto_link_suppressed: false, created_at: `2026-10-01T10:00:0${n % 10}Z`, structure_dsl: null, ...o,
})
const dsl = (min) => `work ${min}min @ 90-110%FTP`
const ACT = { id: 'a1', user_id: 'r', track_id: null, moving_time_s: 3600 }

test('single open workout of the day is chosen', () => {
  const w = W()
  assert.equal(pickAutoLinkCandidate([w], ACT, DAY), w)
})

test('nothing without candidates; linked, skipped, suppressed, gym and other days are ignored', () => {
  assert.equal(pickAutoLinkCandidate([], ACT, DAY), null)
  assert.equal(pickAutoLinkCandidate([W({ activity_id: 'x' })], ACT, DAY), null)
  assert.equal(pickAutoLinkCandidate([W({ status: 'skipped' })], ACT, DAY), null)
  assert.equal(pickAutoLinkCandidate([W({ auto_link_suppressed: true })], ACT, DAY), null)
  assert.equal(pickAutoLinkCandidate([W({ discipline: 'gym' })], ACT, DAY), null)
  assert.equal(pickAutoLinkCandidate([W({ workout_date: '2026-10-22' })], ACT, DAY), null)
  assert.equal(pickAutoLinkCandidate([W()], null, DAY), null)
})

test('a suppressed workout never counts, so the remaining one is the only candidate', () => {
  const sup = W({ auto_link_suppressed: true })
  const other = W()
  assert.equal(pickAutoLinkCandidate([sup, other], ACT, DAY), other)
})

test('several workouts: discipline decides when only one matches', () => {
  const track = W({ discipline: 'track' })
  const ride = W({ discipline: 'ride' })
  assert.equal(pickAutoLinkCandidate([track, ride], ACT, DAY), ride)
  assert.equal(pickAutoLinkCandidate([track, ride], { ...ACT, track_id: 't' }, DAY), track)
  assert.equal(pickAutoLinkCandidate([W({ discipline: 'other' }), W({ discipline: 'track' })], ACT, DAY), null)
})

test('several same-discipline workouts: clearly closest duration wins, otherwise nothing', () => {
  const short = W({ structure_dsl: dsl(30) })
  const long = W({ structure_dsl: dsl(60) })
  assert.equal(pickAutoLinkCandidate([short, long], ACT, DAY), long)
  assert.equal(pickAutoLinkCandidate([short, long], { ...ACT, moving_time_s: 1800 }, DAY), short)
  // 45 min is 50 % off both: not confident
  assert.equal(pickAutoLinkCandidate([short, long], { ...ACT, moving_time_s: 2700 }, DAY), null)
  // without any estimate we cannot tell
  assert.equal(pickAutoLinkCandidate([W(), W()], ACT, DAY), null)
  // no duration on the activity
  assert.equal(pickAutoLinkCandidate([short, long], { ...ACT, moving_time_s: 0 }, DAY), null)
})

test('close durations are ambiguous; an exact tie goes to the earliest created', () => {
  const a = W({ structure_dsl: dsl(58) })
  const b = W({ structure_dsl: dsl(62) })
  assert.equal(pickAutoLinkCandidate([a, b], ACT, DAY), null)
  const first = W({ structure_dsl: dsl(60), created_at: '2026-10-01T09:00:00Z' })
  const second = W({ structure_dsl: dsl(60), created_at: '2026-10-01T10:00:00Z' })
  assert.equal(pickAutoLinkCandidate([second, first], ACT, DAY), first)
})

test('the choice does not depend on input order', () => {
  const short = W({ structure_dsl: dsl(30) })
  const long = W({ structure_dsl: dsl(60) })
  assert.equal(pickAutoLinkCandidate([long, short], ACT, DAY), pickAutoLinkCandidate([short, long], ACT, DAY))
})

test('local day helpers: no UTC shift', () => {
  assert.equal(dayOfLocalStamp('2026-10-23T23:30:00'), '2026-10-23')
  assert.equal(dayOfLocalStamp(null), null)
  assert.equal(dayOfLocalStamp('nonsense'), null)
  assert.equal(localDayOf('not a date'), null)
  assert.equal(activityDiscipline({ track_id: 't' }), 'track')
  assert.equal(activityDiscipline({}), 'ride')
})

// A tiny fake client: .from().select().eq().eq().order() resolves rows; .rpc() records calls.
function fake(rows, { rpcResult = { data: true, error: null } } = {}) {
  const calls = []
  const q = { select: () => q, eq: () => q, order: () => Promise.resolve({ data: rows, error: null }) }
  return { calls, from: () => q, rpc: async (name, args) => { calls.push([name, args]); return rpcResult } }
}

test('autoLinkActivity links the chosen workout through the RPC with the local day', async () => {
  const w = W()
  const c = fake([w])
  const r = await autoLinkActivity(c, { activity: ACT, localDay: DAY })
  assert.deepEqual(r, { linked: true, workoutId: w.id })
  assert.deepEqual(c.calls, [['planned_workout_auto_link', { p_workout: w.id, p_activity: 'a1', p_local_date: DAY }]])
})

test('autoLinkActivity does nothing when ambiguous, without a local day, or when the RPC declines; never throws', async () => {
  const amb = fake([W(), W()])
  assert.equal((await autoLinkActivity(amb, { activity: ACT, localDay: DAY })).linked, false)
  assert.equal(amb.calls.length, 0)
  const c = fake([W()])
  assert.equal((await autoLinkActivity(c, { activity: ACT, localDay: null })).linked, false)
  assert.equal(c.calls.length, 0)
  const declined = fake([W()], { rpcResult: { data: false, error: null } })
  assert.equal((await autoLinkActivity(declined, { activity: ACT, localDay: DAY })).linked, false)
  const errored = fake([W()], { rpcResult: { data: null, error: { message: 'boom' } } })
  assert.equal((await autoLinkActivity(errored, { activity: ACT, localDay: DAY })).linked, false)
  assert.equal((await autoLinkActivity({ from: () => { throw new Error('x') } }, { activity: ACT, localDay: DAY })).linked, false)
})
