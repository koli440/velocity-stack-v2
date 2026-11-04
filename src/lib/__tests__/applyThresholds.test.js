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
  assert.deepEqual(sb.saved[0], { table: 'ftp_history', row: { effective_from: '2026-11-04', ftp_w: 285, user_id: 'u' } })
})

test('applyThreshold writes a new dated entry and needs a user', async () => {
  const sb = fakeSupabase()
  assert.ok((await applyThreshold(sb, { field: 'ftp', value: 285, date: '2026-11-04' })).error)
  const r = await applyThreshold(sb, { userId: 'u', field: 'lt1_hr', value: 130, date: '2026-11-04' })
  assert.equal(r.saved, true)
  assert.equal(sb.saved[0].table, 'lactate_threshold_history')
  assert.equal(sb.saved[0].row.lt1_hr, 130)
})
