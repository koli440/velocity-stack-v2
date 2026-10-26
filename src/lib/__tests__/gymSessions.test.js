import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeActivityType, isGymActivity, isGymSportType } from '../activityType.js'
import { prepareAnalysis, gymSummaryFromMeta } from '../gymAnalysis.js'
import { buildActivityInsert } from '../activityRecord.js'
import { filterStravaActivities, filterStravaRides } from '../strava.js'
import { filterActivities, filterRides } from '../server/intervalsProvider.js'
import { filterWahooRides, isImportableWorkout } from '../wahoo.js'
import { activityDiscipline, pickAutoLinkCandidate } from '../plannedWorkouts.js'
import { activityToEvent } from '../calendar.js'

test('activity type helpers default to ride', () => {
  assert.equal(normalizeActivityType(undefined), 'ride')
  assert.equal(normalizeActivityType('gym'), 'gym')
  assert.equal(normalizeActivityType('bogus'), 'ride')
  assert.ok(isGymActivity({ activity_type: 'gym' }))
  assert.ok(!isGymActivity({}))
  assert.ok(isGymSportType('WeightTraining') && !isGymSportType('Ride'))
})

test('prepareAnalysis leaves rides untouched and trims gym to HR/duration/calories', () => {
  const ride = { summary: { avg_power_w: 200 }, curves: { Power: { 5: 400 } }, time_series: { watts: [1] } }
  const out = prepareAnalysis(ride)
  assert.equal(out.activityType, 'ride')
  assert.equal(out.summary, ride.summary)
  assert.equal(out.curves, ride.curves)

  const gym = {
    summary: { activity_type: 'gym', avg_hr: 120, max_hr: 160, calories: 300, elapsed_time_s: 3600, avg_power_w: 50, distance_m: 5 },
    curves: { Power: { 5: 1 }, HeartRate: { 60: 130 } },
    time_series: { watts: [1], heartrate: [100, 110] },
  }
  const g = prepareAnalysis(gym)
  assert.equal(g.activityType, 'gym')
  assert.deepEqual(Object.keys(g.curves), ['HeartRate'])
  assert.deepEqual(g.time_series, { heartrate: [100, 110] })
  assert.equal(g.summary.avg_power_w, undefined)
  assert.equal(g.summary.calories, 300)
})

test('gymSummaryFromMeta builds a summary-only analysis', () => {
  const m = gymSummaryFromMeta({ startTime: '2027-01-01T10:00:00Z', elapsedS: 1800, avgHr: 118.4, calories: 250 })
  assert.equal(m.summary.activity_type, 'gym')
  assert.equal(m.summary.avg_hr, 118)
  assert.equal(m.summary.calories, 250)
  assert.deepEqual(m.curves, {})
})

test('buildActivityInsert: rides unchanged, gym tagged without load or gear', () => {
  const ride = buildActivityInsert({ start_time: '2027-01-01T10:00:00Z', normalized_power_w: 200, elapsed_time_s: 3600 }, { userId: 'u', ftpWatts: 250, chainring: 48, cog: 15, rideType: 'track' })
  assert.ok(!('activity_type' in ride) && !('calories' in ride))
  assert.equal(ride.chainring, 48)

  const gym = buildActivityInsert({ start_time: '2027-01-01T10:00:00Z', activity_type: 'gym', calories: 320, normalized_power_w: 200, elapsed_time_s: 3600 }, { userId: 'u', ftpWatts: 250, chainring: 48, cog: 15, rideType: 'track', trackId: 't' })
  assert.equal(gym.activity_type, 'gym')
  assert.equal(gym.calories, 320)
  assert.equal(gym.chainring, null)
  assert.equal(gym.track_id, null)
  assert.equal(gym.ride_type, null)
  assert.equal(gym.training_load, null)
  assert.equal(gym.title, 'Gym Session')
})

test('Strava / Intervals / Wahoo listings: rides unchanged, gym tagged', () => {
  const strava = [
    { id: 1, sport_type: 'Ride', name: 'r', start_date: '2027-01-01T00:00:00Z' },
    { id: 2, sport_type: 'WeightTraining', name: 'g', start_date: '2027-01-01T00:00:00Z', average_heartrate: 110, calories: 200 },
    { id: 3, sport_type: 'Run', name: 'x' },
  ]
  assert.equal(filterStravaRides(strava).length, 1)
  const s = filterStravaActivities(strava)
  assert.deepEqual(s.map((a) => a.id), [1, 2])
  assert.equal(s[0].activity_type, undefined)
  assert.equal(s[1].activity_type, 'gym')
  assert.equal(s[1].average_heartrate, 110)

  const icu = [
    { id: 'a', type: 'Ride', name: 'r' },
    { id: 'b', type: 'WeightTraining', name: 'g' },
    { id: 'c', type: 'Run' },
  ]
  assert.equal(filterRides(icu).length, 1)
  const i = filterActivities(icu)
  assert.deepEqual(i.map((a) => a.id), ['a', 'b'])
  assert.equal(i[1].activity_type, 'gym')

  const wahoo = [
    { id: 1, workout_type_id: 0, workout_summary: { file: { url: 'u' } } },
    { id: 2, workout_type_id: 42, starts: '2027-01-01T10:00:00Z', workout_summary: { duration_total_accum: '1800', calories_accum: '210' } },
    { id: 3, workout_type_id: 5, workout_summary: { file: { url: 'u' } } },
  ]
  assert.ok(isImportableWorkout(wahoo[1]))
  const w = filterWahooRides(wahoo)
  assert.deepEqual(w.map((x) => x.id), ['1', '2'])
  assert.equal(w[1].activity_type, 'gym')
  assert.equal(w[1].calories, 210)
  assert.equal(w[0].activity_type, undefined)
})

test('planned workout linking keeps gym and rides apart', () => {
  const gymW = { id: 'g', discipline: 'gym', workout_date: '2027-01-01', created_at: '1' }
  const rideW = { id: 'r', discipline: 'ride', workout_date: '2027-01-01', created_at: '1' }
  assert.equal(activityDiscipline({ activity_type: 'gym' }), 'gym')
  assert.equal(pickAutoLinkCandidate([gymW, rideW], { activity_type: 'gym' }, '2027-01-01')?.id, 'g')
  assert.equal(pickAutoLinkCandidate([rideW], { activity_type: 'gym' }, '2027-01-01'), null)
  assert.equal(pickAutoLinkCandidate([gymW], {}, '2027-01-01'), null)
  assert.equal(pickAutoLinkCandidate([gymW, rideW], {}, '2027-01-01')?.id, 'r')
})

test('calendar shows gym sessions with the gym discipline', () => {
  const e = activityToEvent({ id: 1, activity_date: '2027-01-01T10:00:00Z', activity_type: 'gym', avg_hr: 120, moving_time_s: 1800 })
  assert.equal(e.discipline, 'gym')
  assert.equal(e.distanceM, 0)
})
