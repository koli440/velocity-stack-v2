// Run with: node --test src/lib/__tests__/templateMenu.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  templatePermissions,
  visibleTabs,
  filterByTab,
  searchTemplates,
  addFavorite,
  removeFavorite,
  listFavoriteIds,
  distinctRecentIds,
  listRecentTemplateIds,
  groupByCategory,
} from '../templateMenu.js'

const ME = 'u1'
const sys = { id: 's', slug: 's', name: 'Sys', user_id: null, visibility: 'private', category: 'track' }
const minePriv = { id: 'a', slug: 'a', name: 'Alpha', user_id: ME, visibility: 'private', category: 'road' }
const minePub = { id: 'b', slug: 'b', name: 'Beta', user_id: ME, visibility: 'public', category: 'road' }
const otherPub = { id: 'c', slug: 'c', name: 'Gamma', user_id: 'u2', visibility: 'public', category: 'gym', description: 'hill reps' }
const all = [sys, minePriv, minePub, otherPub]

test('permissions: own private template can do everything', () => {
  assert.deepEqual(templatePermissions(minePriv, ME), { canEdit: true, canToggleVisibility: true, canDelete: true, canFavorite: true })
})
test('permissions: own public template cannot be deleted', () => {
  const p = templatePermissions(minePub, ME)
  assert.equal(p.canDelete, false)
  assert.equal(p.canEdit, true)
})
test('permissions: system and others\' templates are read-only but favoritable', () => {
  for (const t of [sys, otherPub]) {
    assert.deepEqual(templatePermissions(t, ME), { canEdit: false, canToggleVisibility: false, canDelete: false, canFavorite: true })
  }
})
test('permissions: anonymous can do nothing', () => {
  for (const t of all) assert.ok(Object.values(templatePermissions(t, null)).every((v) => v === false))
})

test('tabs: anonymous only sees public and system', () => {
  assert.deepEqual(visibleTabs(null), ['public', 'system'])
  assert.deepEqual(visibleTabs(ME), ['mine', 'favorites', 'public', 'system'])
})

test('filterByTab', () => {
  const ids = (tab, o) => filterByTab(all, tab, o).map((t) => t.id)
  assert.deepEqual(ids('mine', { userId: ME }), ['a', 'b'])
  assert.deepEqual(ids('mine', { userId: null }), [])
  assert.deepEqual(ids('public', { userId: ME }), ['b', 'c'])
  assert.deepEqual(ids('system', { userId: ME }), ['s'])
  assert.deepEqual(ids('favorites', { userId: ME, favoriteIds: new Set(['c']) }), ['c'])
})

test('searchTemplates: query, category, sort', () => {
  assert.deepEqual(searchTemplates(all, { query: 'hill' }).map((t) => t.id), ['c'])
  assert.deepEqual(searchTemplates(all, { category: 'road' }).map((t) => t.id), ['a', 'b'])
  assert.deepEqual(searchTemplates(all, { sort: 'name' }).map((t) => t.name), ['Alpha', 'Beta', 'Gamma', 'Sys'])
})

function fakeClient({ template = { id: 't1' }, upsertError = null, deleteError = null, favs = [] } = {}) {
  const calls = {}
  return {
    calls,
    from(table) {
      if (table === 'analysis_templates') {
        return { select: () => ({ eq: (_c, slug) => ({ maybeSingle: async () => { calls.slug = slug; return { data: template, error: null } } }) }) }
      }
      assert.equal(table, 'template_favorites')
      return {
        upsert: async (row, opts) => { calls.upsert = { row, opts }; return { error: upsertError } },
        delete: () => ({ eq: (c1, v1) => ({ eq: async (c2, v2) => { calls.del = { [c1]: v1, [c2]: v2 }; return { error: deleteError } } }) }),
        select: () => ({ eq: async () => ({ data: favs, error: null }) }),
      }
    },
  }
}

test('favorites API: requires auth', async () => {
  for (const fn of [addFavorite, removeFavorite]) assert.equal((await fn(fakeClient(), null, 'x')).status, 401)
  assert.equal((await listFavoriteIds(fakeClient(), null)).status, 401)
})
test('favorites API: add upserts for the caller', async () => {
  const c = fakeClient()
  const r = await addFavorite(c, { id: ME }, 'slug1')
  assert.equal(r.status, 200)
  assert.deepEqual(c.calls.upsert.row, { user_id: ME, template_id: 't1' })
})
test('favorites API: invisible template reads as 404', async () => {
  assert.equal((await addFavorite(fakeClient({ template: null }), { id: ME }, 'x')).status, 404)
  assert.equal((await removeFavorite(fakeClient({ template: null }), { id: ME }, 'x')).status, 404)
})
test('favorites API: RLS rejection surfaces as 400', async () => {
  const r = await addFavorite(fakeClient({ upsertError: { message: 'denied' } }), { id: ME }, 'x')
  assert.equal(r.status, 400)
})
test('favorites API: remove scopes delete to caller', async () => {
  const c = fakeClient()
  const r = await removeFavorite(c, { id: ME }, 'x')
  assert.equal(r.status, 200)
  assert.deepEqual(c.calls.del, { user_id: ME, template_id: 't1' })
})
test('favorites API: list returns template ids', async () => {
  const r = await listFavoriteIds(fakeClient({ favs: [{ template_id: 'a' }, { template_id: 'b' }] }), { id: ME })
  assert.deepEqual(r.body.favoriteIds, ['a', 'b'])
})

test('recent: dedupes keeping most recent order and limits', () => {
  const rows = ['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g'].map((template_id) => ({ template_id }))
  assert.deepEqual(distinctRecentIds(rows, 5), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(distinctRecentIds(null), [])
})
test('recent: requires auth, scopes to caller, orders by updated_at desc', async () => {
  assert.equal((await listRecentTemplateIds({}, null)).status, 401)
  const calls = {}
  const q = {
    select: () => q,
    eq: (c, v) => { calls.eq = [c, v]; return q },
    order: (c, o) => { calls.order = [c, o]; return q },
    limit: async () => ({ data: [{ template_id: 'x' }, { template_id: 'x' }, { template_id: 'y' }], error: null }),
  }
  const r = await listRecentTemplateIds({ from: (t) => { calls.table = t; return q } }, { id: ME })
  assert.equal(calls.table, 'template_executions')
  assert.deepEqual(calls.eq, ['user_id', ME])
  assert.deepEqual(calls.order, ['updated_at', { ascending: false }])
  assert.deepEqual(r.body.recentIds, ['x', 'y'])
})
test('recent: db error surfaces as 400', async () => {
  const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: null, error: { message: 'boom' } }) }
  assert.equal((await listRecentTemplateIds({ from: () => q }, { id: ME })).status, 400)
})
test('groupByCategory: sorted groups, uncategorized last', () => {
  const g = groupByCategory([{ id: 1, category: 'road' }, { id: 2 }, { id: 3, category: 'gym' }, { id: 4, category: 'road' }])
  assert.deepEqual(g.map((x) => x.category), ['gym', 'road', 'Uncategorized'])
  assert.equal(g[1].items.length, 2)
})
