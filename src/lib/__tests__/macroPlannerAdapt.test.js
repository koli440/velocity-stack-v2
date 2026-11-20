import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays } from '../fitnessForm.js'
import { computeBaseline, generatePlan } from '../macroPlanner.js'
import {
  adherenceReview, applyAvailability, applyMinorRaces, breakDays, composeAdaptedWeeks, focusHint, preBreakTl, returnFractions,
  suggestAdherenceOption, suggestAvailabilityOption, suggestDisruptionOptions, weekAdherence,
} from '../macroPlannerAdapt.js'

const TODAY = '2026-11-18'
const MONDAY = '2026-11-16'

function history(weekly, endMonday = MONDAY) {
  const days = {}
  weekly.forEach((tl, i) => {
    const ws = addDays(endMonday, -7 * (weekly.length - i))
    for (let d = 0; d < 7; d += 1) days[addDays(ws, d)] = { load: tl / 7 }
  })
  return days
}

const mkWeeks = (n, tl = 400) => Array.from({ length: n }, (_, i) => ({
  week_start: addDays('2026-11-02', 7 * i), kind: 'build', target_tl: tl, focus: 'Build', note: '', day_shape: 'RHEHEHE', tl_overridden: false,
}))

test('return fractions grow with break length and are more conservative for illness', () => {
  assert.deepEqual(returnFractions('illness', 'mild', 2), [0.7, 0.9])
  assert.ok(returnFractions('illness', 'mild', 10).length > returnFractions('illness', 'mild', 5).length)
  assert.ok(returnFractions('illness', 'mild', 5)[0] < returnFractions('injury', 'mild', 5)[0])
  assert.ok(returnFractions('illness', 'severe', 5).length > returnFractions('illness', 'mild', 5).length)
  assert.equal(breakDays({ start_date: '2026-11-10', end_date: '2026-11-12' }, TODAY), 3)
  assert.equal(breakDays({ start_date: '2026-11-16' }, TODAY), 3)
})

test('preBreakTl uses recent undisrupted history, falling back to the plan', () => {
  const days = history([300, 300, 300, 300, 300, 300])
  assert.equal(preBreakTl({ days, startDay: '2026-11-17', today: TODAY, weeks: [] }).tl, 300)
  const fb = preBreakTl({ days: {}, startDay: '2026-11-17', today: TODAY, weeks: mkWeeks(3, 250) })
  assert.deepEqual(fb, { tl: 250, source: 'plan' })
})

test('disruption options: shift, compress, lower goal; return weeks are reduced and nothing mutates', () => {
  const days = history([300, 300, 300, 300, 300, 300])
  const weeks = generatePlan({ today: TODAY, raceDate: '2027-02-14', raceLength: 'medium', startWeeklyTl: 300, buildWeeks: 3, recoveryWeeks: 1, rampCeilingPct: 7 }).weeks
  const copy = JSON.stringify(weeks)
  const res = suggestDisruptionOptions({
    weeks, disruption: { id: 'x', kind: 'illness', severity: 'moderate', start_date: '2026-11-16', end_date: '2026-11-22' },
    today: TODAY, raceDate: '2027-02-14', raceLength: 'medium', days, startWeeklyTl: 300, goalCtl: 60,
  })
  assert.equal(JSON.stringify(weeks), copy)
  const keys = res.options.map((o) => o.key)
  assert.ok(keys.includes('shift'))
  for (const o of res.options) {
    assert.ok(o.projection && o.feasibility && o.raceDay)
    assert.equal(o.weeks.length, weeks.length)
    const first = o.weeks.find((w) => w.week_start === MONDAY)
    assert.ok(first.target_tl < 300)
    assert.equal(o.weeks[o.weeks.length - 1].kind, 'taper')
  }
  const lower = res.options.find((o) => o.key === 'lower_goal')
  if (lower) assert.ok(lower.goalCtl <= 60)
})

test('compose keeps week count and anchors taper to the race', () => {
  const w = composeAdaptedWeeks({ startWeek: MONDAY, raceDate: '2027-01-17', raceLength: 'medium', buildWeeks: 3, recoveryWeeks: 1, preTl: 300, step: 0.05 })
  assert.equal(w.length, 9)
  assert.equal(w[w.length - 1].focus, 'Race week')
  assert.equal(w[0].target_tl, 300)
})

test('baseline excludes weeks overlapping a disruption', () => {
  const weekly = [300, 300, 300, 300, 40, 300, 300, 300]
  const days = history(weekly)
  const b = computeBaseline(days, TODAY, { disruptions: [{ start_date: addDays(MONDAY, -21), end_date: addDays(MONDAY, -15) }] })
  assert.ok(b.weeks.some((w) => w.excluded === 'disruption'))
})

test('availability scales target and flattens hard days', () => {
  const weeks = mkWeeks(4, 400)
  const { weeks: out, changed } = applyAvailability(weeks, [{ week_start: weeks[3].week_start, availability_pct: 50, reason: 'travel' }], { today: TODAY })
  assert.equal(out[3].target_tl, 200)
  assert.ok(!out[3].day_shape.includes('H'))
  assert.equal(out[3].tl_overridden, true)
  assert.equal(changed.length, 1)
  assert.equal(weeks[3].target_tl, 400)
  assert.equal(suggestAvailabilityOption({ weeks, availability: [], today: TODAY, raceDate: '2027-02-14' }), null)
})

test('adherence lights and drift trigger', () => {
  const weeks = [0, 1, 2].map((i) => ({ week_start: addDays('2026-10-26', 7 * i), kind: 'build', target_tl: 400, day_shape: 'RHEHEHE' }))
  const mk = (tls) => {
    const days = {}
    tls.forEach((tl, i) => { days[addDays('2026-10-26', 7 * i)] = { load: tl } })
    return weekAdherence({ weeks, days, today: TODAY })
  }
  assert.deepEqual(mk([400, 360, 440]).map((r) => r.light), ['green', 'green', 'green'])
  assert.equal(mk([300, 400, 400])[0].light, 'amber')
  const red = mk([400, 200, 200])
  assert.deepEqual(red.map((r) => r.light), ['green', 'red', 'red'])
  const rev = adherenceReview(red)
  assert.equal(rev.propose, true)
  assert.equal(rev.direction, 'under')
  assert.equal(rev.week_start, '2026-11-09')
  assert.equal(adherenceReview(mk([400, 400, 200])).propose, false)
  const dis = weekAdherence({ weeks, days: {}, today: TODAY, disruptions: [{ start_date: '2026-11-02', end_date: '2026-11-08' }] })
  assert.equal(dis[1].light, 'skip')
})

test('adherence rebase suggestion restarts from actual load', () => {
  const real = generatePlan({ today: TODAY, raceDate: '2027-02-14', raceLength: 'medium', startWeeklyTl: 400, buildWeeks: 3, recoveryWeeks: 1, rampCeilingPct: 7 }).weeks
  const rows = [{ light: 'red', actual: 200, target: 400, ratio: 0.5 }, { light: 'red', actual: 220, target: 400, ratio: 0.55 }]
  const o = suggestAdherenceOption({ weeks: real, rows, today: TODAY, raceDate: '2027-02-14', raceLength: 'medium', days: history([200, 220]), startWeeklyTl: 210 })
  assert.equal(o.level, 210)
  assert.equal(o.weeks.find((w) => w.week_start === MONDAY).target_tl, 210)
})

test('B race mini-taper + recovery, C race train through, invalid races ignored', () => {
  const weeks = mkWeeks(8, 400)
  const r = applyMinorRaces(weeks, [
    { name: 'Gran Fondo', race_date: '2026-11-29', priority: 'B' },
    { name: 'Crit', race_date: '2026-12-13', priority: 'C' },
    { name: 'Old', race_date: '2026-11-01', priority: 'C' },
    { name: 'Late', race_date: '2027-03-01', priority: 'B' },
  ], { raceDate: '2027-01-10', today: TODAY })
  const bw = r.weeks.find((w) => w.week_start === '2026-11-23')
  assert.equal(bw.target_tl, 300)
  assert.match(bw.focus, /^B race/)
  assert.equal(bw.day_shape[6], 'H')
  const after = r.weeks.find((w) => w.week_start === '2026-11-30')
  assert.equal(after.kind, 'recovery')
  const cw = r.weeks.find((w) => w.week_start === '2026-12-07')
  assert.equal(cw.target_tl, 400)
  assert.match(cw.focus, /^C race/)
  assert.deepEqual(r.ignored.map((i) => i.reason).sort(), ['after_a_race', 'past'])
  assert.equal(weeks[1].target_tl, 400)
})

test('focus hint is text only and null for unknown phenotype', () => {
  assert.match(focusHint('sprinter', 'long').text, /Long race/)
  assert.equal(focusHint('nope', 'long'), null)
})
