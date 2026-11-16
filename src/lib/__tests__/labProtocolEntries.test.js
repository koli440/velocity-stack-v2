import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEntry, cadenceProfile, compareFastedFed, fitDeltas, parseGlucoseCsv, parseReadingLines, pedallingTrend, summarizeFueling,
} from '../labProtocolEntries.js'

const reads = [{ t: -10, mmol: 5 }, { t: 30, mmol: 6 }, { t: 60, mmol: 4 }, { t: 90, mmol: 7 }, { t: 120, mmol: 6.5 }, { t: 150, mmol: 5.5 }]

test('fueling validation requires session, readings and duration', () => {
  assert.ok(buildEntry('fueling', { readings: reads, duration_min: 90 }).error)
  assert.ok(buildEntry('fueling', { session: 'fed', readings: reads }).error)
  assert.ok(buildEntry('fueling', { session: 'fed', readings: [reads[0]], duration_min: 90 }).error)
  assert.ok(buildEntry('fueling', { session: 'fed', readings: [{ t: 0, mmol: 50 }, reads[1]], duration_min: 90 }).error)
  const ok = buildEntry('fueling', { session: 'fed', readings: [...reads].reverse(), duration_min: '90', carbs_g_per_h: '60' })
  assert.equal(ok.data.readings[0].t, -10)
  assert.equal(ok.data.carbs_g_per_h, 60)
})

test('summarizeFueling splits before, during and after 30/60 min', () => {
  const s = summarizeFueling({ duration_min: 90, readings: reads })
  assert.deepEqual([s.before, s.duringAvg, s.duringMin, s.duringMax, s.after30, s.after60], [5, 5.7, 4, 7, 6.5, 5.5])
})

test('compareFastedFed averages per session type', () => {
  const mk = (session, carbs, mmol) => ({ kind: 'fueling', data: { session, carbs_g_per_h: carbs, duration_min: 90, readings: [{ t: 10, mmol }, { t: 40, mmol }] } })
  const c = compareFastedFed([mk('fasted', 0, 4), mk('fed', 60, 6), mk('fed', 80, 8)])
  assert.equal(c.fasted.duringAvg, 4)
  assert.deepEqual([c.fed.sessions, c.fed.carbs, c.fed.duringAvg], [2, 70, 7])
})

test('parseReadingLines handles units and bad lines', () => {
  assert.deepEqual(parseReadingLines('0, 99\n30;108', 'mg').readings, [{ t: 0, mmol: 5.5 }, { t: 30, mmol: 6 }])
  assert.ok(parseReadingLines('abc').error)
})

test('parseGlucoseCsv reads Libre (mmol) and Dexcom (mg/dL) exports', () => {
  const libre = 'Device,Serial Number,Device Timestamp,Record Type,Historic Glucose mmol/L\nFreeStyle,X,16-11-2026 09:55,0,5.2\nFreeStyle,X,16-11-2026 10:30,0,6.1\nFreeStyle,X,16-11-2026 23:30,0,9\n'
  const l = parseGlucoseCsv(libre, '2026-11-16T10:00', 90)
  assert.deepEqual(l.readings, [{ t: -5, mmol: 5.2 }, { t: 30, mmol: 6.1 }])
  const dex = 'Index,Timestamp (YYYY-MM-DDThh:mm:ss),Event Type,Glucose Value (mg/dL)\n1,2026-11-16T09:58:00,EGV,90\n2,2026-11-16T10:31:00,EGV,144\n3,2026-11-16T10:40:00,Carbs,\n'
  const d = parseGlucoseCsv(dex, '2026-11-16T10:00', 90)
  assert.deepEqual(d.readings, [{ t: 0, mmol: 5 }, { t: 30, mmol: 8 }])
  assert.ok(parseGlucoseCsv('a,b\n1,2', '2026-11-16T10:00', 90).error)
  assert.ok(parseGlucoseCsv(libre, '', 90).error)
})

test('fit and pedalling validation, fit deltas, pedalling trend', () => {
  assert.ok(buildEntry('fit', {}).error)
  assert.ok(buildEntry('fit', { saddle_height_mm: '2000' }).error)
  assert.ok(buildEntry('pedalling', { avg_power_w: 200 }).error)
  assert.equal(buildEntry('pedalling', { left_balance_pct: '49,5' }).data.left_balance_pct, 49.5)
  const a = buildEntry('fit', { saddle_height_mm: 740, comfort: 4 }).data
  const b = buildEntry('fit', { saddle_height_mm: 735, comfort: 3 }).data
  assert.deepEqual(fitDeltas([{ kind: 'fit', data: a }, { kind: 'fit', data: b }]), { saddle_height_mm: 5, comfort: 1 })
  const rows = [52, 51, 50, 48, 48, 48].map((v) => ({ kind: 'pedalling', data: { left_balance_pct: v } }))
  const t = pedallingTrend(rows).left_balance_pct
  assert.deepEqual([t.latest, t.recent, t.change], [52, 51, 3])
})

test('cadence validation and profile', () => {
  assert.ok(buildEntry('cadence', { steps: [{ rpm: 60, power_w: 200 }] }).error)
  assert.ok(buildEntry('cadence', { steps: [{ rpm: 60, power_w: 200 }, { rpm: 80 }] }).error)
  const ok = buildEntry('cadence', { steps: [{ rpm: 90, power_w: 250, hr: 150 }, { rpm: 70, power_w: 200 }, { rpm: '', power_w: '' }] })
  const p = cadenceProfile(ok.data.steps)
  assert.deepEqual(p.map((x) => [x.rpm, x.pctOfBest, x.best]), [[70, 80, false], [90, 100, true]])
})
