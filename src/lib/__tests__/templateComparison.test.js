import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  anomalies,
  analyzeRun,
  applyRepAnalysis,
  completeness,
  fadeMetrics,
  hasRepAnalysis,
  headlineMetric,
  headlineValue,
  hrRecoveryByRep,
  matchReps,
  repValues,
  selectReference,
  trendSeries,
  verdict,
} from '../templateComparison.js'

const day = (d) => new Date(Date.UTC(2026, 0, 1) + d * 86400000).toISOString()
const powerRun = (id, d, watts, extra = {}) => ({
  id,
  activity_id: `act-${id}`,
  created_at: day(d),
  summary: { avg_power: Math.round(watts.reduce((a, b) => a + b, 0) / watts.length), reps_detected: watts.length, reps_target: watts.length, ...extra },
  efforts: watts.map((w, i) => ({ rep: i + 1, role: 'work', start_sec: i * 300, end_sec: i * 300 + 180, duration_sec: 180, avg_power: w })),
})
const timeRun = (id, d, secs) => ({
  id,
  activity_id: `act-${id}`,
  created_at: day(d),
  summary: { best_time_sec: Math.min(...secs), avg_time_sec: secs.reduce((a, b) => a + b, 0) / secs.length },
  efforts: secs.map((t, i) => ({ rep: i + 1, role: 'work', start_sec: i * 300, end_sec: i * 300 + 60, keyed_by: 'distance', target_distance_m: 1000, elapsed_time_sec: t })),
})
const cur = (r, d) => ({ id: r.id, activity_id: r.activity_id, date: day(d) })

test('headline metric: power for interval templates, time for distance-keyed / TT / sprint', () => {
  assert.equal(headlineMetric(powerRun('a', 0, [300, 300])).id, 'power')
  assert.equal(headlineMetric(timeRun('t', 0, [70, 71])).id, 'time')
  assert.equal(headlineMetric(timeRun('t', 0, [70, 71])).lowerBetter, true)
  assert.equal(headlineMetric({ efforts: [{ avg_power: 400 }], summary: {} }, { manifest: { pattern: 'flying_sprint' } }).id, 'power')
  assert.equal(headlineMetric({ efforts: [{ avg_power: 400, estimated_time: 11.2 }], summary: { estimated_time_sec: 11.2 } }).id, 'time')
  assert.equal(headlineMetric({ efforts: [{ avg_speed_kmh: 40 }], summary: {} }).id, 'speed')
  assert.equal(headlineMetric({ efforts: [], summary: {} }), null)
  assert.equal(headlineMetric(null), null)
})

test('repValues: strict by rep number, falls back to position, multi-step reps are combined', () => {
  const m = headlineMetric(powerRun('a', 0, [300]))
  const run = { efforts: [{ role: 'work', start_sec: 0, avg_power: 300 }, { role: 'recovery', start_sec: 50, avg_power: 100 }, { role: 'work', start_sec: 100, avg_power: 280 }] }
  assert.deepEqual([...repValues(run, m)], [[1, 300], [2, 280]])
  const multi = { efforts: [{ rep: 1, role: 'work', start_sec: 0, duration_sec: 30, avg_power: 400 }, { rep: 1, role: 'work', start_sec: 40, duration_sec: 90, avg_power: 300 }] }
  assert.equal(repValues(multi, m).get(1), 325)
  const t = headlineMetric(timeRun('t', 0, [60]))
  assert.equal(repValues({ efforts: [{ rep: 1, elapsed_time_sec: 10 }, { rep: 1, elapsed_time_sec: 12 }] }, t).get(1), 22)
})

test('reference: previous run excludes the current one and anything later', () => {
  const runs = [powerRun('a', 0, [300]), powerRun('b', 10, [310]), powerRun('c', 20, [320]), powerRun('later', 40, [999])]
  const m = headlineMetric(runs[0])
  const ref = selectReference(runs, cur(runs[2], 20), { mode: 'previous', metric: m })
  assert.equal(ref.runs[0].id, 'b')
  assert.equal(ref.headline, 310)
  assert.equal(selectReference([runs[0]], cur(runs[0], 0), { mode: 'previous', metric: m }), null)
})

test('reference: personal best is direction-aware', () => {
  const m = headlineMetric(powerRun('a', 0, [300]))
  const power = [powerRun('a', 0, [300]), powerRun('b', 5, [350]), powerRun('c', 9, [320]), powerRun('d', 12, [310])]
  assert.equal(selectReference(power, cur(power[3], 12), { mode: 'pb', metric: m }).runs[0].id, 'b')
  const tm = headlineMetric(timeRun('t', 0, [70]))
  const times = [timeRun('a', 0, [72]), timeRun('b', 5, [68]), timeRun('c', 9, [71]), timeRun('d', 12, [70])]
  assert.equal(selectReference(times, cur(times[3], 12), { mode: 'pb', metric: tm }).runs[0].id, 'b')
})

test('reference: median of the last 5 runs has no date window and is robust to one bad day', () => {
  const m = headlineMetric(powerRun('a', 0, [300]))
  const runs = [
    powerRun('old', 0, [100]),
    powerRun('r1', 400, [300]),
    powerRun('r2', 800, [302]),
    powerRun('bad', 1200, [150]),
    powerRun('r4', 1600, [304]),
    powerRun('r5', 2000, [306]),
    powerRun('now', 2400, [310]),
  ]
  const ref = selectReference(runs, cur(runs[6], 2400), { mode: 'median5', metric: m })
  assert.deepEqual(ref.runs.map((r) => r.id).sort(), ['bad', 'r1', 'r2', 'r4', 'r5'])
  assert.equal(ref.headline, 302)
  assert.equal(ref.label, 'Median of last 5 runs')
  const few = selectReference(runs.slice(0, 3), cur(runs[2], 800), { mode: 'median5', metric: m })
  assert.equal(few.count, 2)
  assert.equal(few.label, 'Median of last 2 runs')
})

test('reference: median reps are taken per rep number', () => {
  const m = headlineMetric(powerRun('a', 0, [300]))
  const runs = [powerRun('a', 0, [300, 290, 280]), powerRun('b', 1, [310, 300]), powerRun('c', 2, [320, 310, 270]), powerRun('now', 3, [1])]
  const ref = selectReference(runs, cur(runs[3], 3), { mode: 'median5', metric: m })
  assert.deepEqual([...ref.reps], [[1, 310], [2, 300], [3, 275]])
})

test('reference: custom pick of any other run; unknown pick falls back to previous', () => {
  const m = headlineMetric(powerRun('a', 0, [300]))
  const runs = [powerRun('a', 0, [300]), powerRun('b', 10, [310]), powerRun('c', 20, [320])]
  const custom = selectReference(runs, cur(runs[2], 20), { mode: 'custom', customId: 'a', metric: m })
  assert.equal(custom.runs[0].id, 'a')
  assert.equal(custom.fellBack, false)
  const missing = selectReference(runs, cur(runs[2], 20), { mode: 'custom', customId: 'gone', metric: m })
  assert.equal(missing.mode, 'previous')
  assert.equal(missing.fellBack, true)
  assert.equal(selectReference(runs, cur(runs[2], 20), { mode: 'custom', customId: 'c', metric: m }).fellBack, true)
  assert.equal(selectReference(runs, cur(runs[2], 20), { mode: 'nonsense', metric: m }).mode, 'previous')
})

test('reference: ignores other runs of the same activity and runs without the metric', () => {
  const m = headlineMetric(powerRun('a', 0, [300]))
  const same = { ...powerRun('x', 5, [999]), activity_id: 'act-now' }
  const empty = { id: 'e', activity_id: 'e', created_at: day(6), summary: {}, efforts: [] }
  const now = powerRun('now', 10, [300])
  const ref = selectReference([same, empty, powerRun('p', 1, [250]), now], cur(now, 10), { mode: 'previous', metric: m })
  assert.equal(ref.runs[0].id, 'p')
})

test('verdict is direction-aware with a similar band', () => {
  const power = headlineMetric(powerRun('a', 0, [300]))
  const time = headlineMetric(timeRun('t', 0, [70]))
  assert.equal(verdict(330, 300, power).verdict, 'better')
  assert.equal(verdict(270, 300, power).verdict, 'worse')
  assert.equal(verdict(301, 300, power).verdict, 'similar')
  assert.equal(verdict(66, 70, time).verdict, 'better')
  assert.equal(verdict(74, 70, time).verdict, 'worse')
  assert.equal(verdict(null, 70, time), null)
})

test('matchReps: strictly by rep number, states when counts differ', () => {
  const m = headlineMetric(powerRun('a', 0, [300]))
  const r = matchReps(new Map([[1, 300], [2, 290], [3, 270]]), new Map([[1, 310], [2, 300], [3, 280], [4, 270]]), m)
  assert.equal(r.rows.length, 3)
  assert.deepEqual(r.rows.map((x) => x.diff), [-10, -10, -10])
  assert.equal(r.rows[0].good, false)
  assert.equal(r.rows[1].vsFirstPct, -3.3)
  assert.equal(r.rows[0].vsFirstPct, null)
  assert.deepEqual(r.onlyRef, [4])
  assert.equal(r.countsDiffer, true)
  assert.match(r.note, /Reference has 4 reps, this run 3: comparing the common reps 1–3/)
})

test('matchReps: a missing middle rep is not shifted onto its neighbour', () => {
  const m = headlineMetric(timeRun('t', 0, [70]))
  const r = matchReps(new Map([[1, 70], [3, 72]]), new Map([[1, 71], [2, 71], [3, 73]]), m)
  assert.deepEqual(r.common, [1, 3])
  assert.equal(r.rows[1].diff, -1)
  assert.equal(r.rows[1].good, true)
  assert.deepEqual(r.onlyRef, [2])
  const none = matchReps(new Map([[1, 70]]), new Map([[2, 70]]), m)
  assert.match(none.note, /no common reps/)
  assert.equal(matchReps(new Map([[1, 1]]), new Map(), m).note, null)
})

test('fadeMetrics: halves, worst rep, slope and consistency', () => {
  const m = headlineMetric(powerRun('a', 0, [300]))
  const f = fadeMetrics(new Map([[1, 400], [2, 400], [3, 360], [4, 360]]), m)
  assert.equal(f.firstHalfAvg, 400)
  assert.equal(f.secondHalfAvg, 360)
  assert.equal(f.halfDeltaPct, -10)
  assert.equal(f.halfFadePct, 10)
  assert.equal(f.worst.rep, 3)
  assert.equal(f.worst.index, 3)
  assert.equal(f.worst.pctBelowBest, 10)
  assert.ok(f.slopePctPerRep > 0)
  assert.deepEqual(f.curve.map((c) => c.pctOfBest), [100, 100, 90, 90])
  const flat = fadeMetrics(new Map([[1, 300], [2, 300], [3, 300]]), m)
  assert.equal(flat.slopePctPerRep, 0)
  assert.equal(flat.cvPct, 0)
  assert.equal(flat.consistency, 100)
  assert.equal(fadeMetrics(new Map([[1, 300]]), m), null)
})

test('fadeMetrics: odd rep counts skip the middle rep; lower-is-better fade is positive when slowing', () => {
  const t = headlineMetric(timeRun('t', 0, [70]))
  const f = fadeMetrics(new Map([[1, 70], [2, 90], [3, 72]]), t)
  assert.equal(f.firstHalfAvg, 70)
  assert.equal(f.secondHalfAvg, 72)
  assert.equal(f.halfFadePct, 2.9)
  assert.equal(f.worst.rep, 2)
  assert.deepEqual(f.curve.map((c) => c.pctOfBest), [100, 77.8, 97.2])
  const slowing = fadeMetrics(new Map([[1, 70], [2, 72], [3, 74]]), t)
  assert.ok(slowing.slopePctPerRep > 0)
})

test('fade catches a failed middle set that the drop-off (best vs last) cannot see', () => {
  const m = headlineMetric(powerRun('a', 0, [300]))
  const reps = new Map([[1, 300], [2, 300], [3, 240], [4, 300], [5, 300]])
  const f = fadeMetrics(reps, m)
  assert.equal(f.worst.rep, 3)
  assert.equal(f.worst.pctBelowBest, 20)
  const flags = anomalies(reps, { metric: m })
  assert.deepEqual(flags.map((x) => [x.type, x.rep]), [['low', 3]])
  assert.equal(flags[0].text, 'Rep 3 is 20% below the median')
})

test('anomalies: missing reps (gap and tail) and slow reps for time metrics', () => {
  const m = headlineMetric(powerRun('a', 0, [300]))
  const flags = anomalies(new Map([[1, 300], [2, 300], [4, 300]]), { expected: 5, metric: m })
  assert.deepEqual(flags.map((x) => x.text), ['Rep 3 missing', 'Rep 5 missing'])
  const t = headlineMetric(timeRun('t', 0, [70]))
  assert.equal(anomalies(new Map([[1, 70], [2, 70], [3, 77]]), { metric: t })[0].text, 'Rep 3 is 10% slower than the median')
  assert.deepEqual(anomalies(new Map([[1, 300], [2, 296], [3, 300]]), { metric: m }), [])
  assert.deepEqual(anomalies(new Map(), {}), [])
})

test('completeness flag', () => {
  const m = headlineMetric(powerRun('a', 0, [300]))
  const run = { ...powerRun('a', 0, [300, 300, 300]), summary: { reps_detected: 7, reps_target: 8 } }
  const c = completeness(run, m)
  assert.equal(c.text, '7 of 8 reps detected')
  assert.equal(c.complete, false)
  assert.equal(completeness(powerRun('a', 0, [300, 300]), m).complete, true)
  assert.equal(completeness({ efforts: [{ avg_power: 1 }, { avg_power: 2 }], summary: {} }, m).text, '2 reps detected')
  assert.equal(completeness({ efforts: [{ avg_power: 1 }], summary: {} }, m), null)
})

test('hrRecoveryByRep reads any window and tolerates old runs', () => {
  const run = { efforts: [{ rep: 1, role: 'work', hr_recovery_60s: 30 }, { rep: 2, role: 'work', hr_recovery_60s: 24 }, { rep: 3, role: 'work' }] }
  const r = hrRecoveryByRep(run)
  assert.equal(r.windowSec, 60)
  assert.deepEqual(r.values, [{ rep: 1, bpm: 30 }, { rep: 2, bpm: 24 }])
  assert.equal(r.avg, 27)
  assert.equal(hrRecoveryByRep({ efforts: [{ avg_power: 1 }] }), null)
  assert.equal(hrRecoveryByRep({}), null)
})

test('old runs without per-effort fields still analyse (derived from efforts)', () => {
  const old = { id: 'o', summary: {}, efforts: [{ avg_power: 300, start_sec: 0 }, { avg_power: 290, start_sec: 400 }, { avg_power: 250, start_sec: 800 }] }
  const a = analyzeRun(old)
  assert.equal(a.metric.id, 'power')
  assert.deepEqual([...a.reps.keys()], [1, 2, 3])
  assert.equal(a.headline, 280)
  assert.equal(a.fade.worst.rep, 3)
  assert.equal(analyzeRun({ summary: {}, efforts: [] }).fade, null)
  assert.equal(analyzeRun(null).metric, null)
})

test('trendSeries: oldest first with a running personal best', () => {
  const m = headlineMetric(powerRun('a', 0, [300]))
  const runs = [powerRun('b', 10, [320]), powerRun('a', 0, [300]), powerRun('c', 20, [310]), { id: 'x', summary: {}, efforts: [], created_at: day(30) }]
  const t = trendSeries(runs, m)
  assert.deepEqual(t.map((p) => p.id), ['a', 'b', 'c'])
  assert.deepEqual(t.map((p) => p.best), [300, 320, 320])
  assert.deepEqual(trendSeries([], m), [])
})

test('applyRepAnalysis stores per-effort fields, keeps dropoff_pct and is idempotent', () => {
  const base = powerRun('a', 0, [400, 400, 360, 360])
  const result = { efforts: base.efforts.map(({ rep, ...e }) => e), summary: { avg_power: 380, dropoff_pct: 10, reps_detected: 4, reps_target: 5 } }
  const out = applyRepAnalysis(result)
  assert.equal(out.summary.dropoff_pct, 10)
  assert.equal(out.summary.rep_analysis.reps_expected, 5)
  assert.deepEqual(out.summary.rep_analysis.missing_reps, [5])
  assert.equal(out.summary.rep_analysis.worst_rep, 3)
  assert.equal(out.summary.rep_analysis.half_fade_pct, 10)
  assert.deepEqual(out.efforts.map((e) => e.rep), [1, 2, 3, 4])
  assert.equal(out.efforts[2].pct_of_best, 90)
  assert.equal(out.efforts[2].delta_vs_rep1_pct, -10)
  assert.equal(out.efforts[0].delta_vs_rep1_pct, undefined)
  assert.equal(hasRepAnalysis(out), true)
  assert.equal(hasRepAnalysis(result), false)
  assert.deepEqual(applyRepAnalysis({ efforts: out.efforts, summary: out.summary }), out)
  const empty = { efforts: [], summary: { reason: 'x' } }
  assert.equal(applyRepAnalysis(empty), empty)
})
