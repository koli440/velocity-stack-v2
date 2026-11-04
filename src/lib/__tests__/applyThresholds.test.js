import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProposals, planApply, applyThreshold } from '../applyThresholds.js'
import { THRESHOLD_ESTIMATES_KEY } from '../summaryMetrics.js'

const summary = {
  [THRESHOLD_ESTIMATES_KEY]: [
    { field: 'ftp', value: 285 },
    { field: 'lt2_hr', value: 170 },
    { field: 'lt1_power', value: null },
  ],
}
const activity = { activity_date: '2026-11-04', ftp_at_activity_w: 270, lt2_hr_at_activity: 165 }

test('buildProposals adds deltas vs activity snapshots and skips null values', () => {
  const p = buildProposals(summary, activity)
  assert.equal(p.length, 2)
  assert.deepEqual([p[0].current, p[0].delta, p[0].pct], [270, 15, 5.6])
  assert.deepEqual([p[1].current, p[1].delta], [165, 5])
  assert.deepEqual(buildProposals({}, activity), [])
})

test('planApply FTP flags an existing entry on the same date', () => {
  const h = [{ effective_from: '2026-11-04', ftp_w: 270 }]
  const plan = planApply({ field: 'ftp', value: 285, date: '2026-11-04', ftpHistory: h })
  assert.equal(plan.overwrite, true)
  assert.equal(plan.entry.ftp_w, 285)
  assert.equal(planApply({ field: 'ftp', value: 285, date: '2026-11-05', ftpHistory: h }).overwrite, false)
  assert.ok(planApply({ field: 'ftp', value: 9999, date: '2026-11-05' }).error)
})

test('planApply LT merges into the entry effective on that date', () => {
  const ltHistory = [{ effective_from: '2026-01-01', lt1_power_w: 180, lt1_hr: 130, lt2_power_w: 260, lt2_hr: 165 }]
  const plan = planApply({ field: 'lt2_hr', value: 170, date: '2026-11-04', ltHistory })
  assert.equal(plan.overwrite, false)
  assert.deepEqual(plan.entry, { effective_from: '2026-11-04', lt1_power_w: 180, lt1_hr: 130, lt2_power_w: 260, lt2_hr: 170 })
  assert.equal(plan.previous, 165)
})

test('planApply LT rejects values that break LT1 < LT2', () => {
  const ltHistory = [{ effective_from: '2026-01-01', lt1_power_w: 180, lt2_power_w: 260 }]
  assert.match(planApply({ field: 'lt1_power', value: 300, date: '2026-11-04', ltHistory }).error, /LT1 power/)
})

function fakeSupabase({ ftp = [], lt = [] } = {}) {
  const saved = []
  return {
    saved,
    from(table) {
      const rows = table === 'ftp_history' ? ftp : lt
      return {
        select: () => ({ eq: () => ({ order: async () => ({ data: rows, error: null }) }) }),
        upsert: async (row) => { saved.push({ table, row }); return { error: null } },
      }
    },
  }
}

test('applyThreshold never overwrites without confirmation', async () => {
  const sb = fakeSupabase({ ftp: [{ effective_from: '2026-11-04', ftp_w: 270 }] })
  const first = await applyThreshold(sb, { userId: 'u', field: 'ftp', value: 285, date: '2026-11-04' })
  assert.equal(first.needsConfirm, true)
  assert.equal(sb.saved.length, 0)
  const second = await applyThreshold(sb, { userId: 'u', field: 'ftp', value: 285, date: '2026-11-04', confirmOverwrite: true })
  assert.equal(second.saved, true)
  assert.deepEqual(sb.saved[0], { table: 'ftp_history', row: { effective_from: '2026-11-04', ftp_w: 285, user_id: 'u', source: null, source_activity_id: null, source_run_id: null } })
})

test('applyThreshold writes a new dated entry and needs a user', async () => {
  const sb = fakeSupabase()
  assert.ok((await applyThreshold(sb, { field: 'ftp', value: 285, date: '2026-11-04' })).error)
  const r = await applyThreshold(sb, { userId: 'u', field: 'lt1_hr', value: 130, date: '2026-11-04' })
  assert.equal(r.saved, true)
  assert.equal(sb.saved[0].table, 'lactate_threshold_history')
  assert.equal(sb.saved[0].row.lt1_hr, 130)
})

// Permission model: the rider, or the ACTIVE coach (coaching_status_with => 'athlete'). RLS
// (is_coach_of) enforces the same rule in the database; scripts/db-harness/threshold-apply-adversarial.mjs.
import { canApplyToProfile } from '../applyThresholds.js'

function coachSupabase(status) {
  const sb = fakeSupabase()
  sb.rpc = async () => ({ data: [{ id: 'r', status }], error: null })
  return sb
}
const base = { field: 'ftp', value: 285, date: '2026-11-04', userId: 'rider' }

test('canApplyToProfile: self, active coach, others', () => {
  assert.equal(canApplyToProfile({ viewerId: 'a', riderId: 'a' }).allowed, true)
  assert.deepEqual(canApplyToProfile({ viewerId: 'c', riderId: 'a', coachingStatus: 'athlete' }), { allowed: true, asCoach: true })
  for (const s of ['none', 'invited', 'requested', 'invite_received', 'request_received', 'coach', null]) {
    assert.equal(canApplyToProfile({ viewerId: 'c', riderId: 'a', coachingStatus: s }).allowed, false, String(s))
  }
  assert.equal(canApplyToProfile({ viewerId: null, riderId: 'a' }).allowed, false)
})

test('rider applies to own history', async () => {
  const sb = fakeSupabase()
  const r = await applyThreshold(sb, { ...base, actorId: 'rider' })
  assert.equal(r.saved, true)
  assert.equal(r.asCoach, false)
})

test('authorized coach writes to the rider history with run source', async () => {
  const sb = coachSupabase('athlete')
  const r = await applyThreshold(sb, { ...base, actorId: 'coach', source: { activityId: 'act1', runId: 'run1' } })
  assert.equal(r.saved, true)
  assert.equal(r.asCoach, true)
  assert.deepEqual(sb.saved[0].row, {
    effective_from: '2026-11-04', ftp_w: 285, user_id: 'rider',
    source: 'template_estimate', source_activity_id: 'act1', source_run_id: 'run1',
  })
})

test('unauthorized and read-only (pending / ended) coaches cannot write', async () => {
  for (const status of ['none', 'invited', 'requested']) {
    const sb = coachSupabase(status)
    const r = await applyThreshold(sb, { ...base, actorId: 'coach' })
    assert.equal(r.forbidden, true, status)
    assert.equal(sb.saved.length, 0)
  }
})

test('a rider cannot write through their own coach relationship direction', async () => {
  const sb = coachSupabase('coach')
  assert.equal((await applyThreshold(sb, { ...base, actorId: 'someone' })).forbidden, true)
  assert.equal(sb.saved.length, 0)
})

test('relationship lookup failure blocks the write', async () => {
  const sb = fakeSupabase()
  sb.rpc = async () => ({ data: null, error: { message: 'boom' } })
  const r = await applyThreshold(sb, { ...base, actorId: 'coach' })
  assert.ok(r.error)
  assert.equal(sb.saved.length, 0)
})

test('LT apply from a template run carries the source and merges existing values', () => {
  const plan = planApply({
    field: 'lt1_hr', value: 130, date: '2026-11-04', source: { activityId: 'a', runId: 'r' },
    ltHistory: [{ effective_from: '2026-01-01', lt2_hr: 170 }],
  })
  assert.equal(plan.entry.source, 'template_estimate')
  assert.equal(plan.entry.source_run_id, 'r')
  assert.equal(plan.entry.lt2_hr, 170)
})
