import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canSendRunToPbVault,
  coachRunCoachIds,
  coachRunLabel,
  coachRunnableTemplates,
  compareOptions,
  filterRuns,
  parseRunFilter,
  runActions,
  runTemplateName,
  withTemplateSnapshot,
} from '../coachRuns.js'
import { mapRunRow } from '../templateStats.js'

const own = { id: 'r1', template_id: 't1', by_coach: false }
const byCoach = { id: 'r2', template_id: 't2', by_coach: true, run_by_coach_id: 'c1', template_name: 'Secret', template_slug: 'secret' }

test('filterRuns / parseRunFilter', () => {
  assert.deepEqual(filterRuns([own, byCoach], 'coach'), [byCoach])
  assert.deepEqual(filterRuns([own, byCoach], 'own'), [own])
  assert.equal(filterRuns([own, byCoach]).length, 2)
  assert.equal(parseRunFilter('coach'), 'coach')
  assert.equal(parseRunFilter('x'), 'all')
  assert.deepEqual(filterRuns(null), [])
})

test('coachRunLabel names the coach or falls back to former coach', () => {
  assert.equal(coachRunLabel(own), null)
  assert.equal(coachRunLabel(byCoach, { c1: 'Amy' }), 'run by coach Amy')
  assert.equal(coachRunLabel(byCoach, {}), 'run by former coach')
  assert.equal(coachRunLabel({ by_coach: true, run_by_coach_id: null }, { c1: 'Amy' }), 'run by former coach')
})

test('coachRunCoachIds is distinct and ignores own runs', () => {
  assert.deepEqual(coachRunCoachIds([own, byCoach, byCoach, { by_coach: true, run_by_coach_id: null }]), ['c1'])
})

test('coach can only run own and system templates', () => {
  const list = [{ id: 'a', user_id: null }, { id: 'b', user_id: 'coach' }, { id: 'c', user_id: 'rider' }]
  assert.deepEqual(coachRunnableTemplates(list, 'coach').map((t) => t.id), ['a', 'b'])
  assert.deepEqual(coachRunnableTemplates(list, null).map((t) => t.id), ['a'])
})

test('coach runs never go to the PB Vault', () => {
  assert.equal(canSendRunToPbVault(byCoach), false)
  assert.equal(canSendRunToPbVault(own), true)
})

test('runActions: rider deletes anything, coach only his own runs', () => {
  assert.deepEqual(runActions(byCoach, { userId: 'rider', athleteContext: false }), { canDelete: true, canRerun: false })
  assert.deepEqual(runActions(own, { userId: 'rider', athleteContext: false }), { canDelete: true, canRerun: true })
  assert.deepEqual(runActions(byCoach, { userId: 'c1', athleteContext: true }), { canDelete: true, canRerun: true })
  assert.deepEqual(runActions(byCoach, { userId: 'c2', athleteContext: true }), { canDelete: false, canRerun: false })
  assert.deepEqual(runActions(own, { userId: 'c1', athleteContext: true }), { canDelete: false, canRerun: false })
  assert.equal(runActions({ ...byCoach, template_id: null }, { userId: 'c1', athleteContext: true }).canRerun, false)
})

test('withTemplateSnapshot exposes only name/slug/category', () => {
  const out = withTemplateSnapshot({ ...byCoach, template_category: 'cat' })
  assert.deepEqual(out.analysis_templates, { slug: 'secret', name: 'Secret', category: 'cat' })
  assert.equal(runTemplateName(out), 'Secret')
  const joined = { analysis_templates: { name: 'Live', slug: 'l' } }
  assert.equal(withTemplateSnapshot(joined), joined)
})

test('compareOptions works for unreadable templates', () => {
  assert.deepEqual(compareOptions([byCoach, byCoach, { template_name: 'Alpha', template_slug: 'alpha' }]), [
    { slug: 'alpha', name: 'Alpha' },
    { slug: 'secret', name: 'Secret' },
  ])
})

test('mapRunRow carries the coach stamp', () => {
  const row = mapRunRow({ id: 'x', activity_id: 'a', summary: {}, created_at: '2026-01-01', by_coach: true, run_by_coach_id: 'c1' })
  assert.equal(row.by_coach, true)
  assert.equal(row.run_by_coach_id, 'c1')
  assert.equal(mapRunRow({ id: 'y', activity_id: 'a', summary: {} }).by_coach, false)
})

import { applyRunScope, athleteTemplateGroups, resolveRunScope } from '../coachRuns.js'

const RIDER = '11111111-1111-4111-8111-111111111111'
const COACH = '22222222-2222-4222-8222-222222222222'
const recorder = () => {
  const calls = []
  const q = { eq: (k, v) => (calls.push([k, v]), q) }
  return { q, calls }
}

test('resolveRunScope: own account unless a valid other rider is given', () => {
  assert.deepEqual(resolveRunScope(null, COACH), { ownerId: COACH, coachId: null })
  assert.deepEqual(resolveRunScope('nope', COACH), { ownerId: COACH, coachId: null })
  assert.deepEqual(resolveRunScope(COACH, COACH), { ownerId: COACH, coachId: null })
  assert.deepEqual(resolveRunScope(RIDER.toUpperCase(), COACH), { ownerId: RIDER, coachId: COACH })
})

test('applyRunScope restricts athlete scope to runs stamped by this coach', () => {
  let r = recorder()
  applyRunScope(r.q, resolveRunScope(RIDER, COACH))
  assert.deepEqual(r.calls, [['user_id', RIDER], ['by_coach', true], ['run_by_coach_id', COACH]])
  r = recorder()
  applyRunScope(r.q, resolveRunScope(null, COACH))
  assert.deepEqual(r.calls, [['user_id', COACH]])
})

test('athleteTemplateGroups labels sources and sorts by count', () => {
  const stats = { a: { count: 1, metrics: {} }, b: { count: 3, metrics: {} }, c: { count: 2, metrics: {} } }
  const names = { c: { name: 'Gone', category: null } }
  const tpl = [{ id: 'a', name: 'Sys', user_id: null }, { id: 'b', name: 'Mine', user_id: COACH, category: 'x' }]
  const g = athleteTemplateGroups(stats, names, tpl, COACH)
  assert.deepEqual(g.map((x) => [x.name, x.source]), [['Mine', 'yours'], ['Gone', 'template removed'], ['Sys', 'system']])
})

import { attachSharedActivities, pageRunRows } from '../coachRuns.js'

test('coach run list keeps every run although the raw activity is unreadable (regression: "No runs yet.")', async () => {
  const rows = [
    { id: 'a', activity_id: 'x1', summary: { avg_power: 200 }, created_at: '2026-01-01', activities: null },
    { id: 'b', activity_id: 'x2', summary: { avg_power: 300 }, created_at: '2026-01-02', activities: null },
  ]
  const sb = { from: (t) => ({ select: () => ({ in: async (_c, ids) => ({ data: t === 'shared_activities' ? ids.map((id) => ({ id, title: `T ${id}`, activity_date: id === 'x1' ? '2026-02-01' : '2026-03-01' })) : [] }) }) }) }
  const enriched = await attachSharedActivities(sb, rows)
  const page = pageRunRows(enriched, {})
  assert.equal(page.total, 2)
  assert.deepEqual(page.rows.map((r) => r.id), ['b', 'a'])
  assert.deepEqual(pageRunRows(enriched, { q: 'x1' }).rows.map((r) => r.id), ['a'])
  assert.deepEqual(pageRunRows(enriched, { sort: 'avg_power', dir: 'asc', limit: 1, offset: 1 }).rows.map((r) => r.id), ['b'])
  assert.equal(pageRunRows(rows, {}).total, 2)
})

import { pickerTemplates } from '../coachRuns.js'

test('pickerTemplates: coach in athlete context gets own + system only; everyone needs a DSL', () => {
  const t = [
    { id: 's', user_id: null, dsl_source: 'x' },
    { id: 'c', user_id: 'coach', dsl_source: 'x' },
    { id: 'o', user_id: 'other', dsl_source: 'x' },
    { id: 'n', user_id: 'coach', dsl_source: null },
  ]
  assert.deepEqual(pickerTemplates(t, 'coach', { athleteContext: true }).map((x) => x.id), ['s', 'c'])
  assert.deepEqual(pickerTemplates(t, 'coach').map((x) => x.id), ['s', 'c', 'o'])
  assert.deepEqual(pickerTemplates(null, 'coach'), [])
})
