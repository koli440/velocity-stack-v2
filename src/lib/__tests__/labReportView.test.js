import test from 'node:test'
import assert from 'node:assert/strict'
import { formatWatts, thresholdTiles, phenotypeRows, testSummary, bodyRows } from '../labReportView.js'

test('formatWatts', () => {
  assert.equal(formatWatts(250, 160), '250 W · 160 bpm')
  assert.equal(formatWatts(250), '250 W')
  assert.equal(formatWatts(null, 160), null)
})
test('thresholdTiles omits missing values', () => {
  assert.deepEqual(thresholdTiles(null), [])
  const t = thresholdTiles({ ftp_w: 280, lt2_power_w: 270, lt2_hr: 170 })
  assert.deepEqual(t.map((x) => x.key), ['ftp', 'lt2'])
  assert.equal(t[1].sub, '170 bpm')
})
test('phenotypeRows / testSummary / bodyRows', () => {
  assert.deepEqual(phenotypeRows({ '5s': 15, '20m': 4.1 }), [{ label: 'Best 5s', value: '15 W/kg' }, { label: 'Best 20m', value: '4.1 W/kg' }])
  assert.deepEqual(testSummary({ protocol: 'ramp', ftp: 250 }), ['ramp', 'FTP 250 W'])
  assert.deepEqual(bodyRows({ weight_kg: 70 }), [{ label: 'Weight', value: '70 kg' }])
  assert.deepEqual(bodyRows(null), [])
})
