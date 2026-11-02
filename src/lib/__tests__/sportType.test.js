import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sportFromStrava, sportFromWahoo, sportFromGarminType, sportFromFit, resolveRideType, activitySport, isSportFlavour, sportInfo, SPORTS,
} from '../sportType.js'
import { prepareAnalysis } from '../gymAnalysis.js'
import { buildActivityInsert } from '../activityRecord.js'
import { activityToEvent, activityChipLabel } from '../calendar.js'
import { pickAutoLinkCandidate, linkableActivities } from '../plannedWorkouts.js'
import { filterStravaActivities } from '../strava.js'
import { filterActivities } from '../server/intervalsProvider.js'
import { filterWahooRides } from '../wahoo.js'
import { rideTypeLabel, rideTypeHasGear } from '../rideType.js'
import { ICON_SET } from '../iconSet.js'

test('every provider maps to the same canonical sports', () => {
  assert.equal(sportFromStrava('MountainBikeRide'), 'mtb')
  assert.equal(sportFromStrava('EMountainBikeRide'), 'ebike')
  assert.equal(sportFromStrava('GravelRide'), 'gravel')
  assert.equal(sportFromStrava('VirtualRide'), 'virtual')
  assert.equal(sportFromStrava('TrailRun'), 'trail_run')
  assert.equal(sportFromStrava('VirtualRun'), 'treadmill_run')
  assert.equal(sportFromStrava('Swim'), null)
  assert.equal(sportFromWahoo(13), 'mtb')
  assert.equal(sportFromWahoo('5'), 'treadmill_run')
  assert.equal(sportFromWahoo(4), 'trail_run')
  assert.equal(sportFromWahoo(25), null)
  assert.equal(sportFromGarminType('MOUNTAIN_BIKING'), 'mtb')
  assert.equal(sportFromGarminType('GRAVEL_CYCLING'), 'gravel')
  assert.equal(sportFromGarminType('TREADMILL_RUNNING'), 'treadmill_run')
  assert.equal(sportFromGarminType('TRAIL_RUNNING_V2'), 'trail_run')
  assert.equal(sportFromGarminType('LAP_SWIMMING'), null)
  assert.equal(sportFromFit({ sport: 'cycling', sub_sport: 'mountain' }), 'mtb')
  assert.equal(sportFromFit({ sport: 'cycling', sub_sport: 'virtual_activity' }), 'virtual')
  assert.equal(sportFromFit({ sport: 'cycling' }), 'road')
  assert.equal(sportFromFit({ sport: 'running', sub_sport: 'trail' }), 'trail_run')
  assert.equal(sportFromFit({ sport: 'running', sub_sport: 'treadmill' }), 'treadmill_run')
  assert.equal(sportFromFit({ sport: 'swimming' }), null)
})

test('ride type: detected flavour beats the default, plain road keeps the rider choice, runs own theirs', () => {
  assert.equal(resolveRideType('mtb', 'track'), 'mtb')
  assert.equal(resolveRideType('road', 'track'), 'track')
  assert.equal(resolveRideType('trail_run', 'track'), 'trail_run')
  assert.equal(resolveRideType('gym', 'track'), null)
  assert.equal(resolveRideType(null, 'track'), 'track')
  assert.equal(rideTypeLabel('mtb'), 'MTB')
  assert.equal(rideTypeHasGear('gravel'), false)
})

test('prepareAnalysis keeps run analysis and reports sport / ride type', () => {
  const run = prepareAnalysis({ summary: { activity_type: 'run', sport: 'running', sub_sport: 'trail' }, curves: { HeartRate: {} } })
  assert.equal(run.activityType, 'run')
  assert.equal(run.rideType, 'trail_run')
  assert.deepEqual(run.curves, { HeartRate: {} })
  const mtb = prepareAnalysis({ summary: { sport: 'cycling', sub_sport: 'mountain' } })
  assert.equal(mtb.activityType, 'ride')
  assert.equal(mtb.rideType, 'mtb')
  assert.equal(prepareAnalysis({ summary: {} }, null, 'run').activityType, 'run')
  assert.equal(prepareAnalysis({ summary: {} }, null, 'gravel').sport, 'gravel')
  assert.equal(prepareAnalysis({ summary: {} }).activityType, 'ride')
})

test('runs are stored without cycling power load, track or gear', () => {
  const row = buildActivityInsert(
    { start_time: '2027-01-01T10:00:00Z', normalized_power_w: 200, elapsed_time_s: 3600, avg_hr: 150 },
    { userId: 'u', ftpWatts: 250, chainring: 48, cog: 15, trackId: 't', rideType: 'run', activityType: 'run' }
  )
  assert.equal(row.activity_type, 'run')
  assert.equal(row.ride_type, 'run')
  assert.equal(row.training_load, null)
  assert.equal(row.intensity_factor, null)
  assert.equal(row.track_id, null)
  assert.equal(row.chainring, null)
  const ride = buildActivityInsert({ start_time: '2027-01-01T10:00:00Z', normalized_power_w: 200, elapsed_time_s: 3600 }, { userId: 'u', ftpWatts: 250, rideType: 'mtb' })
  assert.ok(ride.training_load > 0)
  assert.equal(ride.ride_type, 'mtb')
  assert.ok(!('activity_type' in ride))
})

test('calendar events and presentation carry sport, icon and label', () => {
  const base = { id: 'a', activity_date: '2027-01-01T10:00:00Z', title: 't' }
  const mtb = activityToEvent({ ...base, activity_type: 'ride', ride_type: 'mtb' })
  assert.equal(mtb.discipline, 'ride')
  assert.equal(mtb.sportIcon, 'mountain')
  assert.equal(activityChipLabel(mtb), 'MTB')
  const run = activityToEvent({ ...base, activity_type: 'run', ride_type: 'trail_run' })
  assert.equal(run.discipline, 'run')
  assert.equal(activityChipLabel(run), 'Trail run')
  assert.equal(activityChipLabel(activityToEvent({ ...base, activity_type: 'ride' })), 'Ride')
  assert.equal(activityChipLabel(activityToEvent({ ...base, activity_type: 'ride', track_id: 't' })), 'Track')
  assert.equal(activityChipLabel(activityToEvent({ ...base, activity_type: 'gym' })), 'Gym')
  assert.equal(isSportFlavour({ activity_type: 'ride', ride_type: 'gravel' }), true)
  assert.equal(isSportFlavour({ activity_type: 'ride' }), false)
  assert.equal(isSportFlavour({ activity_type: 'ride', track_id: 'x' }), false)
  assert.equal(isSportFlavour({ activity_type: 'gym' }), false)
  assert.equal(activitySport({ activity_type: 'run' }).label, 'Run')
})

test('every sport icon exists in the icon set', () => {
  for (const s of Object.values(SPORTS)) assert.ok(ICON_SET[s.icon], s.icon)
  assert.equal(sportInfo('nope'), null)
})

test('runs never auto-link or hand-link to planned workouts', () => {
  const workouts = [{ id: 'w', discipline: 'ride', workout_date: '2027-01-01', activity_id: null }]
  assert.equal(pickAutoLinkCandidate(workouts, { activity_type: 'run', elapsed_time_s: 3600 }, '2027-01-01'), null)
  const events = [{ id: 'e', kind: 'activity', date: new Date(2027, 0, 1, 10), discipline: 'run' }, { id: 'f', kind: 'activity', date: new Date(2027, 0, 1, 11), discipline: 'ride' }]
  assert.deepEqual(linkableActivities(workouts[0], workouts, events).map((e) => e.id), ['f'])
})

test('listings tag the canonical sport and include runs and flavours', () => {
  const s = filterStravaActivities([{ id: 1, sport_type: 'MountainBikeRide' }, { id: 2, sport_type: 'TrailRun' }, { id: 3, sport_type: 'Swim' }, { id: 4, sport_type: 'EMountainBikeRide' }])
  assert.deepEqual(s.map((a) => [a.id, a.sport]), [[1, 'mtb'], [2, 'trail_run'], [4, 'ebike']])
  const i = filterActivities([{ id: 'a', type: 'GravelRide' }, { id: 'b', type: 'Run' }, { id: 'c', type: 'Swim' }, { id: 'd', type: 'WeightTraining' }])
  assert.deepEqual(i.map((a) => [a.id, a.sport]), [['a', 'gravel'], ['b', 'run'], ['d', 'gym']])
  const w = filterWahooRides([
    { id: 1, workout_type_id: 13, workout_summary: { file: { url: 'u' } } },
    { id: 2, workout_type_id: 1, workout_summary: { file: { url: 'u' } } },
    { id: 3, workout_type_id: 25, workout_summary: { file: { url: 'u' } } },
  ])
  assert.deepEqual(w.map((x) => [x.id, x.sport]), [['1', 'mtb'], ['2', 'run']])
})
