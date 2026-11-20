import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays } from '../fitnessForm.js'
import {
  weekStartOf, computeBaseline, sustainedRamp, generatePlan, projectPlan, plannedDailyLoads, assessFeasibility, defaultDayShape, TAPER_FRACTIONS,
} from '../macroPlanner.js'

const TODAY = '2026-11-18' // a Wednesday
const MONDAY = '2026-11-16'

// weekly TLs ending the week before TODAY's week, oldest first, 100 TL on the first day of each week
function history(weekly) {
  const days = {}
  const first = addDays(MONDAY, -7 * weekly.length)
  weekly.forEach((tl, i) => {
    for (let d = 0; d < 7; d += 1) days[addDays(first, 7 * i + d)] = { load: tl / 7 }
  })
  return days
}

test('weekStartOf returns the Monday', () => {
  assert.equal(weekStartOf('2026-11-18'), '2026-11-16')
  assert.equal(weekStartOf('2026-11-22'), '2026-11-16')
  assert.equal(weekStartOf('2026-11-16'), '2026-11-16')
})

test('baseline: needs 6 usable weeks, else manual', () => {
  assert.equal(computeBaseline(history([300, 300, 300]), TODAY).status, 'manual')
  assert.equal(computeBaseline({}, TODAY).status, 'manual')
  const b = computeBaseline(history([300, 310, 320, 300, 310, 320, 330, 340]), TODAY)
  assert.equal(b.status, 'history')
  assert.equal(b.weeklyTl, 325)
})

test('baseline: sick week and outlier are excluded', () => {
  const b = computeBaseline(history([300, 300, 50, 300, 300, 900, 300, 300]), TODAY)
  assert.equal(b.status, 'history')
  assert.equal(b.excluded, 2)
  assert.deepEqual(b.weeks.filter((w) => w.excluded).map((w) => w.excluded).sort(), ['high', 'low'])
  assert.equal(b.weeklyTl, 300)
})

test('sustained ramp needs 10 weeks and ignores windows with excluded weeks', () => {
  assert.equal(sustainedRamp(computeBaseline(history([300, 310, 320, 330, 340, 350, 360, 370]), TODAY).weeks), null)
  const steady = computeBaseline(history([200, 200, 200, 250, 300, 350, 400, 400, 400, 400, 400, 400]), TODAY)
  assert.ok(steady.sustainedRamp > 1)
})

test('generate: 3+1 mesocycles, ramp ceiling, recovery weeks, taper to race week', () => {
  const race = '2027-01-23' // Saturday, 10 weeks from the plan week
  const g = generatePlan({ today: TODAY, raceDate: race, raceLength: 'medium', template: '3+1', startWeeklyTl: 300, rampCeilingPct: 7 })
  assert.equal(g.error, null)
  assert.equal(g.weeks.length, 10)
  assert.equal(g.weeks[0].week_start, MONDAY)
  assert.deepEqual(g.weeks.map((w) => w.kind), ['build', 'build', 'build', 'recovery', 'build', 'build', 'build', 'recovery', 'taper', 'taper'].map((k, i) => (i === 7 ? 'build' : k)))
  assert.equal(g.weeks[0].target_tl, 300)
  assert.equal(g.weeks[1].target_tl, Math.round(300 * 1.07))
  assert.ok(g.weeks[3].target_tl < g.weeks[2].target_tl)
  for (let i = 1; i < g.weeks.length; i += 1) {
    const prev = g.weeks.slice(0, i).filter((w) => w.kind === 'build').pop()
    if (g.weeks[i].kind === 'build') assert.ok(g.weeks[i].target_tl <= prev.target_tl * 1.07 + 1)
  }
  const peak = Math.max(...g.weeks.filter((w) => w.kind === 'build').map((w) => w.target_tl))
  assert.equal(g.weeks[8].target_tl, Math.round(peak * TAPER_FRACTIONS.medium[0]))
  assert.equal(g.weeks[9].focus, 'Race week')
  assert.equal(g.weeks[9].day_shape[5], 'H') // Saturday
  assert.equal(g.weeks[9].day_shape[4], 'R')
})

test('generate: taper length follows race length and a trailing recovery becomes build', () => {
  const race = '2026-12-12'
  const ultra = generatePlan({ today: TODAY, raceDate: race, raceLength: 'ultra', template: '2+1', startWeeklyTl: 300 })
  assert.equal(ultra.weeks.filter((w) => w.kind === 'taper').length, 3)
  const short = generatePlan({ today: TODAY, raceDate: race, raceLength: 'short', template: '2+1', startWeeklyTl: 300 })
  assert.equal(short.weeks.filter((w) => w.kind === 'taper').length, 1)
  assert.notEqual(short.weeks[short.weeks.length - 2].kind, 'recovery')
})

test('generate: validation', () => {
  assert.ok(generatePlan({ today: TODAY, raceDate: TODAY, startWeeklyTl: 300 }).error)
  assert.ok(generatePlan({ today: TODAY, raceDate: '2027-03-01', startWeeklyTl: 0 }).error)
  assert.ok(generatePlan({ today: TODAY, raceDate: '2029-03-01', startWeeklyTl: 300 }).error)
  assert.ok(generatePlan({ today: TODAY, raceDate: '2027-03-01', startWeeklyTl: 300, buildWeeks: 9 }).error)
})

test('generate: goal CTL picks the smallest sufficient step, or flags an unreachable goal', () => {
  const args = { today: TODAY, raceDate: '2027-03-06', raceLength: 'medium', template: '3+1', startWeeklyTl: 300 }
  const easy = generatePlan({ ...args, goalCtl: 45, rampCeilingPct: 7 })
  const hard = generatePlan({ ...args, rampCeilingPct: 7 })
  assert.equal(easy.goalReachable, true)
  assert.ok(easy.step < hard.step)
  const impossible = generatePlan({ ...args, goalCtl: 400, rampCeilingPct: 7 })
  assert.equal(impossible.goalReachable, false)
  assert.equal(impossible.step, 0.07)
})

test('planned loads follow the day shape and stop at the race day', () => {
  const w = { week_start: MONDAY, target_tl: 400, day_shape: 'RHEHEHE' }
  const d = plannedDailyLoads([w], null)
  assert.equal(d[MONDAY], undefined)
  assert.equal(Math.round(d[addDays(MONDAY, 1)].load), 89) // 400 * 2/9
  assert.equal(Math.round(d[addDays(MONDAY, 2)].load), 44)
  assert.equal(Math.round(Object.values(d).reduce((s, x) => s + x.load, 0)), 400)
  const race = plannedDailyLoads([{ ...w, day_shape: defaultDayShape('taper', { raceWeekday: 5 }) }], addDays(MONDAY, 5))
  assert.equal(race[addDays(MONDAY, 6)], undefined)
  assert.equal(Math.round(Object.values(race).reduce((s, x) => s + x.load, 0)), 400)
})

test('projection: plan from a steady history, race-day form is an estimate and the taper freshens the athlete', () => {
  const days = history([300, 300, 300, 300, 300, 300, 300, 300])
  const baseline = computeBaseline(days, TODAY)
  const race = '2027-01-23'
  const g = generatePlan({ today: TODAY, raceDate: race, raceLength: 'medium', template: '3+1', startWeeklyTl: baseline.weeklyTl, days })
  const p = projectPlan({ weeks: g.weeks, days, today: TODAY, raceDate: race, startWeeklyTl: baseline.weeklyTl })
  assert.ok(p.plan.length > 0 && p.forecast.length > 0)
  assert.equal(p.raceDay.estimate, true)
  assert.equal(p.raceDay.day, race)
  const peak = p.forecast.reduce((m, x) => Math.max(m, x.fitness), 0)
  assert.ok(p.raceDay.fitness < peak)
  assert.ok(p.raceDay.form > 0, 'tapered athlete is fresh on race day')
  assert.ok(p.actual.every((x) => x.day <= TODAY))
  const noHistory = projectPlan({ weeks: g.weeks, days: {}, today: TODAY, raceDate: race, startWeeklyTl: 300, baselineStatus: 'manual' })
  assert.equal(noHistory.actual.length, 0)
  assert.ok(noHistory.raceDay)
})

test('feasibility: ok within the sustained ramp, unrealistic far above it, overrides are warned about', () => {
  const days = history([300, 300, 300, 300, 300, 300, 300, 300])
  const race = '2027-01-23'
  const g = generatePlan({ today: TODAY, raceDate: race, template: '3+1', startWeeklyTl: 300, days })
  const p = projectPlan({ weeks: g.weeks, days, today: TODAY, raceDate: race, startWeeklyTl: 300 })
  const okRes = assessFeasibility({ weeks: g.weeks, projection: p, sustained: 8 })
  assert.equal(okRes.verdict, 'ok')
  assert.equal(okRes.warnings.length, 0)
  const harsh = assessFeasibility({ weeks: g.weeks, projection: p, sustained: 0.5 })
  assert.notEqual(harsh.verdict, 'ok')
  const over = g.weeks.map((w, i) => (i === 1 ? { ...w, target_tl: w.target_tl * 2, tl_overridden: true } : w))
  assert.ok(assessFeasibility({ weeks: over, projection: p, sustained: 8 }).warnings.some((x) => x.type === 'ceiling'))
  const noRest = g.weeks.map((w) => ({ ...w, kind: w.kind === 'taper' ? 'taper' : 'build' }))
  assert.ok(assessFeasibility({ weeks: noRest, projection: p, sustained: 8 }).warnings.some((x) => x.type === 'no_recovery'))
  assert.equal(assessFeasibility({ weeks: g.weeks, projection: p, sustained: null }).usedDefault, true)
  assert.equal(assessFeasibility({ weeks: g.weeks, projection: p, sustained: 8, goalCtl: 300, goalReachable: false }).goalMissed, true)
})
