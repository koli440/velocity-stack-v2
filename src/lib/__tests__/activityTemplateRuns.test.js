import test from 'node:test'
import assert from 'node:assert/strict'
import { runDetail, runsBadgeLabel, groupRunsByActivity, fetchActivityRuns } from '../activityTemplateRuns.js'

test('runDetail uses summary, falls back to efforts and name snapshot', () => {
  assert.deepEqual(
    runDetail({ id: 'a', template_name: 'Snap', summary: { avg_power: 300.4, np_w: 320.6 }, by_coach: true }),
    { id: 'a', name: 'Snap', avgPower: 300, np: 321, byCoach: true },
  )
  const d = runDetail({ id: 'b', analysis_templates: { name: 'Live' }, summary: {}, efforts: [{ avg_power: 200 }, { avg_power: 300, np_w: 310 }] })
  assert.equal(d.name, 'Live')
  assert.equal(d.avgPower, 250)
  assert.equal(d.np, 310)
  assert.equal(runDetail({ summary: {} }).avgPower, null)
  assert.equal(runDetail({}).name, 'Template')
})

test('runsBadgeLabel', () => {
  assert.equal(runsBadgeLabel([]), null)
  assert.equal(runsBadgeLabel([{ name: 'Flying 200' }]), 'Flying 200')
  assert.equal(runsBadgeLabel([{ name: 'a' }, { name: 'b' }]), '2 runs')
})

test('groupRunsByActivity and batched fetch', async () => {
  const rows = [{ activity_id: 'x', id: 1 }, { activity_id: 'x', id: 2 }, { activity_id: 'y', id: 3 }]
  assert.equal(groupRunsByActivity(rows).get('x').length, 2)
  let calls = 0
  const sb = { from: () => ({ select: () => ({ in: (_c, ids) => ({ order: async () => { calls++; assert.deepEqual(ids, ['x', 'y']); return { data: rows, error: null } } }) }) }) }
  const m = await fetchActivityRuns(sb, ['x', 'y', 'x'])
  assert.equal(calls, 1)
  assert.equal(m.get('y').length, 1)
  assert.equal((await fetchActivityRuns({ from: () => { throw new Error('x') } }, ['a'])).size, 0)
})
