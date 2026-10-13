import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backfillRoutePreviews, refreshUserBadges, syncFeedData } from '../feedSync.js'

function fakeClient({ previewRows = [], history = [], pbs = [] } = {}) {
  const updates = []
  let previewQueue = [...previewRows]
  return {
    updates,
    from(table) {
      const state = { table, filters: [], update: null }
      const b = {
        select(cols) { state.cols = cols; return b },
        update(v) { state.update = v; return b },
        eq(c, v) { state.filters.push([c, v]); return b },
        is() { return b },
        order() { return b },
        limit(n) { state.limit = n; return b },
        then(resolve) {
          if (state.update) {
            updates.push({ id: state.filters.find((f) => f[0] === 'id')?.[1], ...state.update })
            return resolve({ error: null })
          }
          if (table === 'personal_bests') return resolve({ data: pbs, error: null })
          if (state.cols?.includes('lat:')) {
            const batch = previewQueue.splice(0, state.limit)
            return resolve({ data: batch, error: null })
          }
          return resolve({ data: history, error: null })
        },
      }
      return b
    },
  }
}

test('backfillRoutePreviews writes previews and sentinels', async () => {
  const c = fakeClient({
    previewRows: [
      { id: 'a', lat: [50, 50.01], lng: [14, 14.01], watts: null },
      { id: 'b', lat: null, lng: null, watts: null },
    ],
  })
  const n = await backfillRoutePreviews(c, 'u')
  assert.equal(n, 2)
  assert.equal(c.updates.find((u) => u.id === 'a').route_preview.kind, 'route')
  assert.deepEqual(c.updates.find((u) => u.id === 'b').route_preview, { kind: 'none' })
})

test('refreshUserBadges only updates rows whose badges changed', async () => {
  const c = fakeClient({
    history: [
      { id: 'a', activity_date: '2026-01-01T00:00:00Z', intensity_factor: 1.2, badges: null },
      { id: 'b', activity_date: '2026-01-02T00:00:00Z', badges: [] },
      {
        id: 'c',
        activity_date: '2026-01-03T00:00:00Z',
        intensity_factor: 1.1,
        badges: [{ kind: 'HARD_SESSION', detail: 'Intensity factor 1.10' }],
      },
    ],
  })
  const { updated } = await refreshUserBadges(c, 'u')
  assert.equal(updated, 1)
  assert.deepEqual(c.updates[0], { id: 'a', badges: [{ kind: 'HARD_SESSION', detail: 'Intensity factor 1.20' }] })
})

test('syncFeedData is a no-op without a user', async () => {
  assert.deepEqual(await syncFeedData(fakeClient(), null), { previews: 0, badges: 0 })
})
