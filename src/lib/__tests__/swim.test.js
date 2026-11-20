process.env.TZ = 'Europe/Prague'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatSwimDistance, formatSwimPace } from '../swim.js'
import { activityLoad, SWIM_DEFAULT_INTENSITY } from '../fitnessForm.js'
import { prepareAnalysis } from '../gymAnalysis.js'
import { generateActivityName, isGenericActivityName } from '../activityNaming.js'
import { activityToEvent, activityChipLabel } from '../calendar.js'
import { activityDiscipline, pickAutoLinkCandidate } from '../plannedWorkouts.js'
import { filterStravaActivities } from '../strava.js'
import { filterActivities } from '../server/intervalsProvider.js'
import { filterWahooRides } from '../wahoo.js'
import { summaryMetrics } from '../heroCard.js'
import { createStravaProvider } from '../server/stravaProvider.js'
import { buildActivityInsert } from '../activityRecord.js'

test('swim distance is in metres, pace per 100 m', () => {
  assert.deepEqual(formatSwimDistance(1500), { value: '1,500', unit: 'm' })
  assert.deepEqual(formatSwimDistance(12500), { value: '12.50', unit: 'km' })
  assert.equal(formatSwimDistance(0), null)
  assert.equal(formatSwimPace(1500, 1800), '2:00')
  assert.equal(formatSwimPace(null, 1800), null)
  assert.deepEqual(summaryMetrics({ activity_type: 'swim', distance_m: 1000, moving_time_s: 1500 }).map((m) => m.key), ['distance', 'time', 'pace'])
})

test('swim load: HR based when usable, else a default intensity so it still counts', () => {
  const withHr = activityLoad({ activity_type: 'swim', moving_time_s: 3600, avg_hr: 150, lt2_hr_at_activity: 170 })
  assert.equal(withHr.load, Math.round((150 / 170) ** 2 * 1000) / 10)
  const noHr = activityLoad({ activity_type: 'swim', moving_time_s: 3600 })
  assert.deepEqual(noHr, { load: 36, estimated: true })
  assert.equal(SWIM_DEFAULT_INTENSITY, 0.6)
  assert.equal(activityLoad({ activity_type: 'swim', moving_time_s: 60 }), null)
  assert.equal(activityLoad({ activity_type: 'ride', moving_time_s: 3600 }), null)
})

test('swims are classified from the sport and flavoured by GPS', () => {
  const pool = prepareAnalysis({ summary: {}, time_series: {} }, null, 'pool_swim')
  assert.equal(pool.activityType, 'swim')
  assert.equal(pool.sport, 'pool_swim')
  const gps = prepareAnalysis({ summary: {}, time_series: { latitude: [50.1, 50.2] } }, null, 'pool_swim')
  assert.equal(gps.sport, 'open_water_swim')
  assert.equal(prepareAnalysis({ summary: { sport: 'swimming', sub_sport: 'open_water' } }).activityType, 'swim')
})

test('swim names and generic fallback', () => {
  assert.equal(isGenericActivityName('Strava Swim'), true)
  assert.equal(isGenericActivityName('Lap Swimming'), true)
  const a = generateActivityName({ seed: 's', activityType: 'swim', sport: 'pool_swim', rideType: 'pool_swim', summary: {}, localHour: 7, recentNames: [] })
  assert.ok(a.length > 3)
  assert.notEqual(a, generateActivityName({ seed: 's', activityType: 'swim', sport: 'pool_swim', rideType: 'pool_swim', summary: {}, localHour: 7, recentNames: [a] }))
})

test('calendar shows swims as their own discipline and never links them to planned workouts', () => {
  const ev = activityToEvent({ id: 'a', activity_date: '2027-01-01T08:00:00Z', activity_type: 'swim', ride_type: 'pool_swim', moving_time_s: 1800, avg_hr: 120 })
  assert.equal(ev.discipline, 'swim')
  assert.equal(activityChipLabel(ev), 'Pool swim')
  assert.equal(activityDiscipline({ activity_type: 'swim' }), 'swim')
  const w = { id: 'r', discipline: 'ride', workout_date: '2027-01-01', created_at: '1' }
  assert.equal(pickAutoLinkCandidate([w], { activity_type: 'swim' }, '2027-01-01'), null)
})

test('providers list swims with their flavour', () => {
  const s = filterStravaActivities([{ id: 1, sport_type: 'Swim', distance: 1000, average_heartrate: 130 }, { id: 2, sport_type: 'OpenWaterSwim' }])
  assert.deepEqual(s.map((a) => a.sport), ['pool_swim', 'open_water_swim'])
  assert.equal(s[0].average_heartrate, 130)
  assert.deepEqual(filterActivities([{ id: 'a', type: 'Swim' }, { id: 'b', type: 'OpenWaterSwim' }]).map((a) => a.sport), ['pool_swim', 'open_water_swim'])
  const w = filterWahooRides([{ id: 1, workout_type_id: 25, workout_summary: { file: { url: 'u' } } }, { id: 2, workout_type_id: 26, workout_summary: {} }])
  assert.deepEqual(w.map((x) => [x.id, x.sport]), [['1', 'pool_swim']])
})

test('Strava swim without streams imports from the summary', async () => {
  const detail = { id: 9, name: 'Pool', sport_type: 'Swim', start_date: '2026-10-01T08:00:00Z', start_date_local: '2026-10-01T10:00:00Z', elapsed_time: 2000, moving_time: 1800, distance: 1500, average_heartrate: 128 }
  const fetchImpl = async (url) => (String(url).includes('/streams') ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(detail)))
  const out = await createStravaProvider({ accessToken: 't', fetchImpl }).fetchActivity(9, {})
  assert.equal(out.activityType, 'swim')
  assert.equal(out.sport, 'pool_swim')
  assert.equal(out.summary.distance_m, 1500)
  assert.equal(out.summary.avg_hr, 128)
  assert.equal(out.summary.moving_time_s, 1800)
})

test('swim records store the type and no cycling data', () => {
  const r = buildActivityInsert({ distance_m: 1500, moving_time_s: 1800, avg_hr: 120, start_time: '2026-10-01T08:00:00Z' }, { title: 'Swim', userId: 'u', activityType: 'swim', rideType: 'pool_swim', chainring: 50, cog: 15, ftpWatts: 250 })
  assert.equal(r.activity_type, 'swim')
  assert.equal(r.ride_type, 'pool_swim')
  assert.equal(r.training_load ?? null, null)
  assert.equal(r.chainring ?? null, null)
})
