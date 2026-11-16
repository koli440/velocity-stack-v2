import test from 'node:test'
import assert from 'node:assert/strict'
import { LAB_FEATURES } from '../labFeatures.js'
import { ageEffect } from '../labPowerProfile.js'
import { FEATURE_REPORT_SECTIONS, REPORT_EXEMPT, REPORT_SECTIONS, allowedSections, buildSnapshot, isReportPath, isValidToken, reportPath, validateReportInput } from '../labReports.js'

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

test('every Lab feature is registered in the report builder or explicitly exempt', () => {
  const keys = new Set(REPORT_SECTIONS.map((x) => x.key))
  for (const f of LAB_FEATURES) {
    const mapped = FEATURE_REPORT_SECTIONS[f.key]
    assert.ok(mapped || REPORT_EXEMPT[f.key], `Lab feature "${f.key}" has no report section: add it to FEATURE_REPORT_SECTIONS or REPORT_EXEMPT`)
    for (const k of mapped || []) assert.ok(keys.has(k), `report section "${k}" missing`)
  }
  for (const k of keys) assert.ok(Object.values(FEATURE_REPORT_SECTIONS).flat().includes(k), `section ${k} belongs to no feature`)
})

const entries = [
  { kind: 'fueling', recorded_at: '2027-02-01T08:00:00Z', data: { session: 'fasted', carbs_g_per_h: 60, avg_power_w: 200, lines: [] } },
  { kind: 'fit', recorded_at: '2027-02-02T08:00:00Z', data: { saddle_height_mm: 720, comfort: 4 } },
  { kind: 'cadence', recorded_at: '2027-02-03T08:00:00Z', data: { steps: [{ rpm: 70, power_w: 250 }, { rpm: 90, power_w: 270 }] } },
  { kind: 'pedalling', recorded_at: '2027-02-04T08:00:00Z', data: { left_balance_pct: 49 } },
]
const full = {
  ...source,
  lactate: { test_date: '2027-01-05', result: { lt1: { power: 180, hr: 135 }, lt2: { power: 250, hr: 160 } } },
  durability: [{ date: '2027-01-01', result: { freshW: 300, fatiguedW: 280, kj: 2000, dropPct: 6.7 } }],
  decoupling: [{ date: '2027-01-01', result: { avgW: 200, ef: 1.4, decouplingPct: 3.2 } }],
  aero: [{ test_date: '2027-01-01', position_name: 'Hoods', cda: 0.3, speed_kmh: 40, power_w: 250 }],
  mobility: { mobility_pass: 5, mobility_total: 7 },
  sprint: { sprint_distance_m: 200, sprint_time_s: 12 },
  entries,
}

test('a full source produces every report section, health and own-only ones for the athlete', () => {
  const all = REPORT_SECTIONS.map((x) => x.key)
  const own = buildSnapshot(all, full, { isOwnAthlete: true })
  for (const k of all) assert.ok(own[k] !== undefined, `section ${k} not produced`)
  const coach = buildSnapshot(all, full, { isOwnAthlete: false })
  for (const k of ['forms', 'fueling', 'aero']) assert.equal(coach[k], undefined)
  assert.ok(coach.lactate && coach.durability && coach.decoupling && coach.fit && coach.pedalling && coach.cadence)
  assert.equal(buildSnapshot(['decoupling'], full, { isOwnAthlete: true }).decoupling[0].decoupling_pct, 3.2)
})

test('age effect states age, adjustment or a missing age', () => {
  assert.equal(ageEffect(null).applied, false)
  assert.match(ageEffect(undefined).note, /Age not set/)
  assert.match(ageEffect(30).note, /no age adjustment/)
  const a = ageEffect(45)
  assert.ok(a.applied && a.factor < 1 && /45/.test(a.note))
})

test('phenotype snapshot carries the age note', () => {
  const s = buildSnapshot(['phenotype'], { profile: { ...source.profile, age: ageEffect(null) } }, { isOwnAthlete: false })
  assert.match(s.phenotype.age_note, /Age not set/)
})
