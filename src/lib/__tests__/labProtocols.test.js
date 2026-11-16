import test from 'node:test'
import assert from 'node:assert/strict'
import { LAB_PROTOCOLS, LAB_PROTOCOL_IDS, computeProtocolResult, criticalPower, pickBestCandidate, protocolDescription, validateLabResult } from '../labProtocols.js'
import { buildCreateArgs, detectFromActivities, detectionWindow } from '../labRuns.js'

const stream = (parts) => parts.flatMap(([sec, w]) => Array(sec).fill(w))

test('every protocol builds a parsable structured workout within the planned limits', () => {
  for (const id of LAB_PROTOCOL_IDS) {
    const { args, error } = buildCreateArgs({ athleteId: 'a', protocol: id, day: '2027-01-10' })
    assert.equal(error, undefined, id)
    assert.ok(args.p_manifest && args.p_dsl.length <= 4000 && args.p_description.length <= 2000)
    assert.ok(args.p_title.length <= 80)
  }
  assert.ok(buildCreateArgs({ athleteId: 'a', protocol: 'nope', day: '2027-01-10' }).error)
  assert.ok(buildCreateArgs({ athleteId: 'a', protocol: 'ftp_20', day: 'x' }).error)
})

test('20 minute test: FTP is 95% of the best 20 minutes', () => {
  const r = computeProtocolResult('ftp_20', stream([[600, 150], [1200, 300], [300, 120]]))
  assert.equal(r.ftp, 285)
  assert.deepEqual(r.proposals, [{ field: 'ftp', value: 285, label: 'FTP 285 W' }])
})

test('8 minute test uses 90% and ramp test 75% of the best minute', () => {
  assert.equal(computeProtocolResult('ftp_8', stream([[300, 100], [480, 400], [300, 100]])).ftp, 360)
  assert.equal(computeProtocolResult('ftp_ramp', stream([[600, 150], [60, 400], [30, 0]])).ftp, 300)
})

test('critical power from two efforts', () => {
  // CP 250 W, W' 20 kJ: 3 min = 250 + 20000/180, 12 min = 250 + 20000/720
  const m = criticalPower({ durationSec: 180, avgW: 361 }, { durationSec: 720, avgW: 278 })
  assert.equal(m.cp, 250)
  assert.ok(Math.abs(m.wPrime - 20000) < 200)
  assert.equal(criticalPower({ durationSec: 180, avgW: 300 }, { durationSec: 720, avgW: 300 }), null)
  assert.equal(criticalPower({ durationSec: 720, avgW: 300 }, { durationSec: 180, avgW: 361 }), null)
})

test('CP3/CP12 result carries cp, W prime and an FTP proposal; too-short streams give no result', () => {
  const r = computeProtocolResult('cp3_12', stream([[600, 120], [180, 361], [1800, 100], [720, 278]]))
  assert.equal(r.cp, 250)
  assert.equal(r.proposals[0].value, 250)
  assert.equal(computeProtocolResult('cp3_12', stream([[100, 300]])), null)
  assert.equal(computeProtocolResult('ftp_20', null), null)
})

test('validateLabResult rejects unknown protocols and oversized results', () => {
  assert.ok(validateLabResult({ protocol: 'ftp_20' }).result)
  assert.ok(validateLabResult({ protocol: 'x' }).error)
  assert.ok(validateLabResult({ protocol: 'ftp_20', pad: 'a'.repeat(9000) }).error)
  assert.ok(validateLabResult([]).error)
})

test('detection picks the strongest candidate ride', () => {
  const acts = [
    { id: 'easy', time_series: { watts: stream([[1300, 150]]) } },
    { id: 'test', time_series: { watts: stream([[600, 150], [1200, 300]]) } },
    { id: 'nopower', time_series: {} },
  ]
  const { best, candidates } = detectFromActivities('ftp_20', acts)
  assert.equal(best.activity.id, 'test')
  assert.equal(candidates.filter((c) => c.result).length, 2)
  assert.equal(pickBestCandidate([]), null)
})

test('detection window spans the day before to two days after', () => {
  assert.deepEqual(detectionWindow('2027-01-10'), { from: '2027-01-09', to: '2027-01-12' })
})

test('protocol descriptions are brief texts', () => {
  assert.match(protocolDescription('cp5_20'), /1\. Warm up/)
  assert.equal(protocolDescription('x'), '')
  assert.ok(Object.values(LAB_PROTOCOLS).every((p) => p.steps.length >= 3))
})
