import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedSections, buildSnapshot, isReportPath, isValidToken, reportPath, validateReportInput } from '../labReports.js'

const source = {
  ftp: { ftp_w: 280, effective_from: '2027-01-02', secret: 'x' },
  lt: { lt1_power_w: 190, lt2_power_w: 255, lt1_hr: 140, lt2_hr: null },
  runs: [
    { status: 'applied', protocol: 'ftp_20', planned_date: '2027-01-02', result: { ftp: 280, junk: 1 } },
    { status: 'planned', protocol: 'ftp_8', planned_date: '2027-02-01', result: null },
  ],
  profile: { phenotype: { type: 'sprinter' }, rows: [{ key: '5s', wkg: 17 }, { key: '1m', wkg: 8 }, { key: '5m', wkg: 5 }, { key: '20m', wkg: 4 }] },
  body: { weight_kg: 70, body_fat_pct: 11, other: 1 },
}

test('snapshot keeps only chosen whitelisted numeric fields', () => {
  const s = buildSnapshot(['thresholds', 'tests', 'phenotype'], source, { isOwnAthlete: false })
  assert.deepEqual(s.thresholds, { ftp_w: 280, lt1_power_w: 190, lt2_power_w: 255, lt1_hr: 140, as_of: '2027-01-02' })
  assert.deepEqual(s.tests, [{ protocol: 'ftp_20', date: '2027-01-02', ftp: 280 }])
  assert.deepEqual(s.phenotype, { label: 'Sprinter', '5s': 17, '1m': 8, '5m': 5, '20m': 4 })
  assert.equal(s.forms, undefined)
})

test('body composition is only included for the athlete themselves', () => {
  assert.equal(buildSnapshot(['forms'], source, { isOwnAthlete: false }).forms, undefined)
  assert.deepEqual(buildSnapshot(['forms'], source, { isOwnAthlete: true }).forms, { weight_kg: 70, body_fat_pct: 11 })
  assert.ok(!allowedSections(false).some((s) => s.key === 'forms'))
  assert.ok(allowedSections(true).some((s) => s.key === 'forms'))
})

test('input validation and token/path helpers', () => {
  assert.ok(validateReportInput({ title: ' ', snapshot: { a: 1 } }).error)
  assert.ok(validateReportInput({ title: 'T', snapshot: {} }).error)
  assert.ok(validateReportInput({ title: 'T', note: 'x'.repeat(301), snapshot: { a: 1 } }).error)
  assert.equal(validateReportInput({ title: ' T ', snapshot: { a: 1 } }).title, 'T')
  const t = 'a'.repeat(64)
  assert.ok(isValidToken(t) && !isValidToken('abc') && !isValidToken(t.toUpperCase()))
  assert.ok(isReportPath(reportPath(t)) && !isReportPath('/lab/protocols'))
})
