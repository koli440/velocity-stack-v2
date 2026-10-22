import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validatePlanned,
  plannedStatus,
  plannedByLabel,
  plannedEditedLabel,
  plannedProfileIds,
  summarizeStructure,
  suggestMatches,
  linkableActivities,
  parseStructure,
  workoutSummary,
  setPlannedStructure,
  runForPlanned,
  groupPlannedByDay,
  shiftDayKey,
  canMoveTo,
  countPlannedByDay,
  defaultDuplicateDay,
  plannedToEvent,
  fetchPlannedInRange,
  createPlanned,
  updatePlanned,
  deletePlanned,
  linkPlannedActivity,
  PLANNED_TITLE_MAX,
  PLANNED_DESCRIPTION_MAX,
  PLANNED_PER_DAY_MAX,
} from '../plannedWorkouts.js'
import { parseIntervalDsl, buildIntervalManifest } from '../intervalDsl.js'
import { buildMonthGrid, buildCalendarRows } from '../calendar.js'

const TODAY = new Date(2026, 9, 20, 12)
const W = (o = {}) => ({ id: 'w1', rider_id: 'r', workout_date: '2026-10-20', discipline: 'ride', title: 'T', status: 'planned', activity_id: null, created_at: '2026-10-01T00:00:00Z', ...o })

function manifestOf(dsl) {
  const p = parseIntervalDsl(dsl)
  assert.deepEqual(p.errors, [])
  return buildIntervalManifest(p)
}

test('validatePlanned', () => {
  assert.deepEqual(validatePlanned({ title: ' Spin ', description: ' n ', discipline: 'track', day: '2026-10-20' }).value, { title: 'Spin', description: 'n', discipline: 'track', day: '2026-10-20' })
  assert.ok(validatePlanned({ title: '' }).error)
  assert.ok(!validatePlanned({ title: '', hasTemplate: true }).error)
  assert.ok(validatePlanned({ title: 'x'.repeat(PLANNED_TITLE_MAX + 1) }).error)
  assert.ok(validatePlanned({ title: 'x', description: 'y'.repeat(PLANNED_DESCRIPTION_MAX + 1) }).error)
  assert.ok(validatePlanned({ title: 'x', discipline: 'swim' }).error)
  assert.ok(validatePlanned({ title: 'x', day: '20-10-2026' }).error)
  assert.equal(validatePlanned({ title: 'x' }).value.discipline, 'ride')
})

test('status: completed / skipped / missed (derived) / planned', () => {
  assert.equal(plannedStatus(W({ activity_id: 'a' }), TODAY), 'completed')
  assert.equal(plannedStatus(W({ activity_id: 'a', workout_date: '2026-09-01' }), TODAY), 'completed')
  assert.equal(plannedStatus(W({ status: 'skipped', workout_date: '2026-09-01' }), TODAY), 'skipped')
  assert.equal(plannedStatus(W({ workout_date: '2026-10-19' }), TODAY), 'missed')
  assert.equal(plannedStatus(W({ workout_date: '2026-10-20' }), TODAY), 'planned')
  assert.equal(plannedStatus(W({ workout_date: '2026-10-21' }), TODAY), 'planned')
})

test('labels: coach name, former coach, You, rider', () => {
  const coachW = { set_by_coach: true, created_by: 'c1', updated_by: 'c1' }
  assert.equal(plannedByLabel(coachW, { c1: 'Amy' }, 'r'), 'planned by coach Amy')
  assert.equal(plannedByLabel(coachW, {}, 'r'), 'planned by former coach')
  assert.equal(plannedByLabel({ ...coachW, created_by: null }, { c1: 'Amy' }, 'r'), 'planned by former coach')
  assert.equal(plannedByLabel({ set_by_coach: false, created_by: 'r' }, {}, 'r'), 'planned by You')
  assert.equal(plannedByLabel({ set_by_coach: false, created_by: 'r' }, {}, 'c1'), 'planned by rider')
  assert.equal(plannedEditedLabel({ created_by: 'c1', updated_by: 'r', set_by_coach: true }, { r: 'Rita' }, 'c1'), 'edited by Rita')
  assert.equal(plannedEditedLabel({ created_by: 'c1', updated_by: 'c1', set_by_coach: true }, {}, 'c1'), null)
  assert.equal(plannedEditedLabel({ created_by: 'r', updated_by: null, set_by_coach: false }, {}, 'r'), 'edited by former coach')
  assert.deepEqual(plannedProfileIds([coachW, { created_by: 'r', updated_by: 'c1' }]).sort(), ['c1', 'r'])
})

test('summarizeStructure: duration, targets and load', () => {
  const m = manifestOf('4x\nwork 5min ±10% @ 90-110%FTP\nrecovery 3min ±20% @ <55%FTP')
  const s = summarizeStructure(m)
  assert.equal(s.durationS, 4 * (300 + 180))
  assert.equal(s.lines[0], '4x')
  assert.equal(s.lines[1], '  Work 5min @ 90-110%FTP')
  assert.equal(s.lines[2], '  Recovery 3min @ <55%FTP')
  // 4 * (5/60 * 1.0^2 + 3/60 * 0.55^2) * 100
  assert.equal(s.load, Math.round(4 * ((300 / 3600) * 1 + (180 / 3600) * 0.55 * 0.55) * 100))
  assert.equal(s.partial, false)
})

test('summarizeStructure: warm-up/cool-down, sets, distance steps, legacy, empty', () => {
  const withWc = summarizeStructure({ pattern: 'custom_intervals', repeat_count: 2, steps: [{ role: 'work', keyBy: 'duration', targetDurationSec: 60, bandType: 'watts', powerMin: 300, powerMax: 350 }], warmup_sec: 600, cooldown_sec: 300 })
  assert.equal(withWc.durationS, 600 + 300 + 120)
  assert.equal(withWc.load, null)
  assert.ok(withWc.lines.includes('Warm-up 10min') && withWc.lines.includes('Cool-down 5min'))
  const km = summarizeStructure({ steps: [{ role: 'work', keyBy: 'distance', targetDistanceM: 4000, bandType: 'best', bestMetric: 'speed' }], repeat_count: 3 })
  assert.equal(km.durationS, null)
  assert.equal(km.partial, true)
  assert.equal(km.lines[1], '  Work 4km @ best speed')
  const sets = summarizeStructure({ repeat_count: 3, set_count: 2, steps: [{ role: 'work', keyBy: 'duration', targetDurationSec: 60, bandType: 'zone', powerMin: 4, powerMax: 5 }], set_recovery: { role: 'recovery', keyBy: 'duration', targetDurationSec: 300, bandType: 'zone', powerMax: 2 } })
  assert.equal(sets.durationS, 2 * 3 * 60 + 300)
  assert.ok(sets.lines.includes('2 sets of 3x'))
  assert.equal(sets.lines[1], '  Work 1min @ Z4-Z5')
  assert.deepEqual(summarizeStructure({ pattern: 'flying_sprint' }).lines, ['Pattern: flying sprint'])
  assert.equal(summarizeStructure(null), null)
  assert.equal(summarizeStructure({}), null)
})

const act = (id, h, discipline = 'ride', durationS = 3600) => ({ id, kind: 'activity', date: new Date(2026, 9, 20, h), discipline, durationS })

test('suggestMatches: same day + discipline, one-to-one', () => {
  const ws = [W({ id: 'w1' }), W({ id: 'w2', created_at: '2026-10-02T00:00:00Z' }), W({ id: 'w3', workout_date: '2026-10-21' })]
  const acts = [act('a1', 8), act('a2', 18), act('a3', 9, 'track'), { ...act('a4', 9), date: new Date(2026, 9, 22, 9) }]
  const m = suggestMatches(ws, acts)
  assert.equal(m.get('w1'), 'a1')
  assert.equal(m.get('w2'), 'a2')
  assert.equal(m.has('w3'), false)
})

test('suggestMatches: ignores linked/skipped workouts, linked activities, other disciplines; prefers closest duration', () => {
  const m = manifestOf('1x\nwork 30min ±10% @ 90-110%FTP')
  const ws = [W({ id: 'w1', structure_manifest: m }), W({ id: 'w2', activity_id: 'a9' }), W({ id: 'w3', status: 'skipped' })]
  const acts = [act('a1', 8, 'ride', 3600), act('a2', 9, 'ride', 1800), act('a9', 7)]
  const out = suggestMatches(ws, acts)
  assert.equal(out.get('w1'), 'a2')
  assert.equal(out.size, 1)
  assert.equal(suggestMatches([W({ discipline: 'gym' })], [act('a1', 8)]).size, 0)
  assert.equal(suggestMatches(null, null).size, 0)
})

test('linkableActivities lists the planned day only, free activities, same discipline first', () => {
  const ws = [W({ id: 'w1' }), W({ id: 'w2', activity_id: 'a2' })]
  const trk = { ...act('a4', 10), discipline: 'track' }
  const acts = [act('a1', 8), act('a2', 9), { ...act('a3', 8), date: new Date(2026, 9, 25, 8) }, trk, { ...act('a5', 23), date: new Date(2026, 9, 20, 23, 59) }, { ...act('a6', 0), date: new Date(2026, 9, 21, 0, 1) }]
  assert.deepEqual(linkableActivities(ws[0], ws, acts).map((a) => a.id), ['a1', 'a5', 'a4'])
  assert.deepEqual(linkableActivities(ws[1], ws, acts).map((a) => a.id), ['a1', 'a2', 'a5', 'a4'])
  assert.deepEqual(linkableActivities(W({ discipline: 'gym' }), ws, acts).map((a) => a.id), ['a1', 'a4', 'a5'])
})

test('parseStructure validates with the template parser and builds the manifest', () => {
  assert.equal(parseStructure('  \n ').empty, true)
  const ok = parseStructure('4x\nwork 5min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP')
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.manifest.repeat_count, 4)
  assert.ok(parseStructure('nonsense').errors.length)
  assert.equal(parseStructure('nonsense').manifest, null)
  assert.ok(parseStructure('1x\nwork 1min ±30% @ best\n' + '#'.repeat(4000)).errors.length)
  assert.equal(workoutSummary({ structure_dsl: '2x\nwork 5min ±30% @ 90-110%FTP' }).durationS, 600)
  assert.equal(workoutSummary({ structure_dsl: null, structure_manifest: null }), null)
})

test('createPlanned sends the DSL snapshot, no stamps, and blocks invalid DSL', async () => {
  const c = fakeClient({ rpc: { data: W(), error: null } })
  const r = await createPlanned(c, { riderId: 'r', day: '2026-10-20', title: ' Easy ', dsl: '2x\nwork 5min ±30% @ 90-110%FTP', templateName: 'Tpl', created_by: 'evil' })
  assert.ok(!r.error)
  const [, name, args] = c.calls.find((x) => x[0] === 'rpc')
  assert.equal(name, 'planned_workout_create')
  assert.deepEqual(Object.keys(args).sort(), ['p_date', 'p_description', 'p_discipline', 'p_dsl', 'p_manifest', 'p_rider', 'p_template_name', 'p_title'])
  assert.equal(args.p_dsl, '2x\nwork 5min ±30% @ 90-110%FTP')
  assert.equal(args.p_manifest.repeat_count, 2)
  const blank = fakeClient({ rpc: { data: W(), error: null } })
  await createPlanned(blank, { riderId: 'r', day: '2026-10-20', title: 'Free', dsl: '  ', templateName: 'Ghost' })
  const b = blank.calls.find((x) => x[0] === 'rpc')[2]
  assert.deepEqual([b.p_dsl, b.p_manifest, b.p_template_name], [null, null, null])
  const bad = fakeClient({ rpc: { data: W(), error: null } })
  assert.ok((await createPlanned(bad, { riderId: 'r', day: '2026-10-20', title: 'x', dsl: 'garbage' })).error)
  assert.equal(bad.calls.some((x) => x[0] === 'rpc'), false)
  assert.ok((await createPlanned(c, { riderId: 'r', day: '2026-10-20', title: '' })).error)
})

test('setPlannedStructure parses client side and clears on blank', async () => {
  const c = fakeClient({ rpc: { data: W(), error: null } })
  await setPlannedStructure(c, 'w1', { dsl: '' })
  assert.deepEqual(c.calls.find((x) => x[0] === 'rpc')[2], { p_id: 'w1', p_dsl: null, p_manifest: null, p_template_name: null })
  assert.ok((await setPlannedStructure(c, 'w1', { dsl: 'nope' })).error)
})

test('runForPlanned finds the run of the planned structure on the linked activity', () => {
  const runs = [{ activity_id: 'a1', template_name: 'Other' }, { activity_id: 'a1', template_name: 'Sweet spot' }, { activity_id: 'a2', template_name: 'Sweet spot' }]
  assert.equal(runForPlanned(W({ activity_id: 'a1', source_template_name: 'Sweet spot' }), runs), runs[1])
  assert.equal(runForPlanned(W({ activity_id: 'a1', source_template_name: 'Nope' }), runs), null)
  assert.equal(runForPlanned(W({ activity_id: null, source_template_name: 'Sweet spot' }), runs), null)
  assert.equal(runForPlanned(W({ activity_id: 'a1' }), runs), null)
})

test('grouping, counting, moving and duplicating days', () => {
  const ws = [W({ id: 'b', created_at: '2026-10-02' }), W({ id: 'a', created_at: '2026-10-01' }), W({ id: 'c', workout_date: '2026-10-21' }), { id: 'bad', workout_date: 'x' }]
  const g = groupPlannedByDay(ws)
  assert.deepEqual(g['2026-10-20'].map((w) => w.id), ['a', 'b'])
  assert.equal(g['2026-10-21'].length, 1)
  assert.deepEqual(countPlannedByDay(ws.slice(0, 3)), { '2026-10-20': 2, '2026-10-21': 1 })
  assert.equal(shiftDayKey('2026-10-31', 1), '2026-11-01')
  assert.equal(shiftDayKey('2026-03-29', 1), '2026-03-30')
  assert.equal(shiftDayKey('2026-01-01', -1), '2025-12-31')
  assert.equal(defaultDuplicateDay(W({ workout_date: '2026-12-31' })), '2027-01-01')
  assert.equal(canMoveTo(W(), '2026-10-22').ok, true)
  assert.equal(canMoveTo(W(), '2026-10-20').ok, false)
  assert.equal(canMoveTo(W(), 'nope').ok, false)
  assert.equal(canMoveTo(W(), '2026-10-22', { '2026-10-22': PLANNED_PER_DAY_MAX }).ok, false)
})

test('plannedToEvent feeds the calendar day cell next to activities and notes', () => {
  const m = manifestOf('4x\nwork 5min ±10% @ 90-110%FTP\nrecovery 3min ±20% @ <55%FTP')
  const ev = plannedToEvent(W({ structure_manifest: m, title: 'Sweet spot' }), TODAY)
  assert.equal(ev.kind, 'planned')
  assert.equal(ev.status, 'planned')
  assert.equal(ev.durationS, 1920)
  assert.match(ev.metric.value, /^~TL \d+$/)
  const weeks = buildMonthGrid(new Date(2026, 9, 1))
  const rows = buildCalendarRows(weeks, [ev, { ...act('a1', 8), title: 'Ride' }], { anchor: new Date(2026, 9, 1), today: TODAY })
  const cell = rows.flatMap((r) => r.cells).find((c) => c.key === '2026-10-20')
  assert.deepEqual(cell.events.map((e) => e.kind).sort(), ['activity', 'planned'])
})

function fakeClient({ select = { data: [], error: null }, rpc = { data: null, error: null }, mutate = { data: [], error: null } } = {}) {
  const calls = []
  const chain = (result) => {
    const q = { calls }
    for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'update', 'delete']) q[m] = (...a) => (calls.push([m, ...a]), q)
    q.maybeSingle = () => Promise.resolve(result)
    q.then = (res) => res(result)
    return q
  }
  return { calls, from: (t) => (calls.push(['from', t]), chain(select)), rpc: (n, a) => (calls.push(['rpc', n, a]), Promise.resolve(rpc)), _mutate: mutate }
}

test('fetchPlannedInRange queries only the range and the rider', async () => {
  const c = fakeClient({ select: { data: [W()], error: null } })
  const r = await fetchPlannedInRange(c, { riderId: 'r', startDay: '2026-09-28', endDay: '2026-11-08' })
  assert.equal(r.data.length, 1)
  assert.deepEqual(c.calls.filter((x) => ['eq', 'gte', 'lte'].includes(x[0])), [['eq', 'rider_id', 'r'], ['gte', 'workout_date', '2026-09-28'], ['lte', 'workout_date', '2026-11-08']])
  assert.deepEqual(await fetchPlannedInRange(c, { riderId: null, startDay: '2026-09-28', endDay: '2026-11-08' }), { data: [], error: null })
})


test('updatePlanned only patches client-writable columns; deletePlanned; link', async () => {
  const c = fakeClient({ select: { data: W({ title: 'New' }), error: null } })
  const r = await updatePlanned(c, 'w1', { day: '2026-10-22', title: 'New', created_by: 'evil', activity_id: 'a' })
  assert.equal(r.data.title, 'New')
  assert.deepEqual(c.calls.find((x) => x[0] === 'update')[1], { workout_date: '2026-10-22', title: 'New' })
  assert.ok((await updatePlanned(c, 'w1', { status: 'done' })).error)
  assert.ok((await updatePlanned(c, 'w1', { day: 'bad' })).error)
  assert.ok((await updatePlanned(c, 'w1', {})).error)
  const none = fakeClient({ select: { data: null, error: null } })
  assert.ok((await updatePlanned(none, 'w1', { title: 'x' })).error)
  assert.ok((await deletePlanned(fakeClient({ select: { data: [], error: null } }), 'w1')).error)
  assert.ok(!(await deletePlanned(fakeClient({ select: { data: [{ id: 'w1' }], error: null } }), 'w1')).error)
  const l = fakeClient({ rpc: { data: W({ activity_id: 'a1' }), error: null } })
  assert.equal((await linkPlannedActivity(l, 'w1', 'a1')).data.activity_id, 'a1')
})

// --- #284 / #285: one status source through move / link / unlink sequences ---------------------
// Mirrors what the server returns: move changes workout_date, link sets activity_id (and clears skipped),
// unlink clears activity_id. The rider and a coach see the same rows, so both contexts use the same helper.
const move = (w, day) => ({ ...w, workout_date: day })
const link = (w, id) => ({ ...w, activity_id: id, status: 'planned' })
const unlink = (w) => ({ ...w, activity_id: null })
const statusOf = (w) => plannedStatus(w, TODAY)
const eventStatus = (w) => plannedToEvent(w, TODAY).status

test('#284 owner repro: planned Tue, moved to Wed (today) and linked is completed, never missed', () => {
  let w = W({ workout_date: '2026-10-19' }) // yesterday, not done
  assert.equal(statusOf(w), 'missed')
  w = move(w, '2026-10-20') // moved to today
  assert.equal(statusOf(w), 'planned')
  w = link(w, 'a1')
  assert.equal(statusOf(w), 'completed')
  assert.equal(eventStatus(w), 'completed')
})

test('#284 link then move keeps completed on any day; unlink falls back to the day rules; relink completes again', () => {
  let w = link(W({ workout_date: '2026-10-19' }), 'a1')
  assert.equal(statusOf(w), 'completed')
  w = move(w, '2026-10-18')
  assert.equal(statusOf(w), 'completed')
  w = unlink(w)
  assert.equal(statusOf(w), 'missed')
  w = move(w, '2026-10-20')
  assert.equal(statusOf(w), 'planned')
  w = move(w, '2026-10-25')
  assert.equal(statusOf(w), 'planned')
  w = link(w, 'a2')
  assert.equal(statusOf(w), 'completed')
  assert.equal(statusOf(unlink(w)), 'planned')
})

test('#285 unlink does not touch skipped; link clears it; every status display agrees (chip, dialog helper, week summary)', () => {
  const skipped = W({ status: 'skipped', workout_date: '2026-10-19' })
  assert.equal(statusOf(skipped), 'skipped')
  assert.equal(statusOf(unlink(skipped)), 'skipped')
  const linked = link(skipped, 'a1')
  assert.equal(linked.status, 'planned')
  assert.equal(statusOf(linked), 'completed')
  const rows = buildCalendarRows(buildMonthGrid(new Date(2026, 9, 1)), [plannedToEvent(linked, TODAY)], { anchor: new Date(2026, 9, 1), today: TODAY })
  const ev = rows.flatMap((r) => r.cells).flatMap((c) => c.events)
  assert.deepEqual(ev.map((e) => e.status), ['completed'])
})

test('#286 week summary: planned time from the structure; skipped excluded, linked and missed counted', () => {
  const dsl = '4x\nwork 5min @ 90-110%FTP\nrecovery 2min @ <55%FTP'
  const W2 = (o) => W({ structure_dsl: dsl, ...o })
  const ws = [
    W2({ id: 'a', workout_date: '2026-10-19' }), // missed, 28 min
    link(W2({ id: 'b', workout_date: '2026-10-20' }), 'act'), // completed, 28 min
    W2({ id: 'c', workout_date: '2026-10-21', status: 'skipped' }), // excluded
  ]
  const rows = buildCalendarRows(buildMonthGrid(new Date(2026, 9, 1)), ws.map((w) => plannedToEvent(w, TODAY)), { anchor: new Date(2026, 9, 1), today: TODAY })
  const wk = rows.find((r) => r.cells.some((c) => c.key === '2026-10-20'))
  assert.equal(wk.summary.plannedCount, 2)
  assert.equal(wk.summary.plannedDurationS, 2 * 28 * 60)
  assert.equal(wk.summary.plannedPartial, false)
})

test('#286 week summary flags partial when a workout has no computable duration', () => {
  const noStructure = W({ id: 'n' })
  const distance = W({ id: 'd', structure_dsl: 'work 10km @ 90-110%FTP' })
  const timed = W({ id: 't', structure_dsl: 'work 20min @ 90-110%FTP' })
  const sum = (ws) => buildCalendarRows(buildMonthGrid(new Date(2026, 9, 1)), ws.map((w) => plannedToEvent(w, TODAY)), { anchor: new Date(2026, 9, 1), today: TODAY })
    .find((r) => r.cells.some((c) => c.key === '2026-10-20')).summary
  assert.equal(sum([timed]).plannedPartial, false)
  assert.equal(sum([timed]).plannedDurationS, 1200)
  assert.equal(sum([timed, noStructure]).plannedPartial, true)
  assert.equal(sum([timed, noStructure]).plannedDurationS, 1200)
  assert.equal(sum([timed, distance]).plannedPartial, true)
})
