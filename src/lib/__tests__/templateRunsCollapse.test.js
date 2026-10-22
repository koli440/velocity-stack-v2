import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SECTION_COLLAPSED_KEY, collapsedSummary, isRunOpen, latestRunId, readSectionCollapsed, writeSectionCollapsed,
} from '../templateRunsCollapse.js'

const mem = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
}

test('section collapsed state round-trips and defaults to expanded', () => {
  const s = mem()
  assert.equal(readSectionCollapsed(s), false)
  writeSectionCollapsed(s, true)
  assert.equal(s.getItem(SECTION_COLLAPSED_KEY), '1')
  assert.equal(readSectionCollapsed(s), true)
  writeSectionCollapsed(s, false)
  assert.equal(readSectionCollapsed(s), false)
})

test('storage failures never throw', () => {
  const bad = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') }, removeItem() { throw new Error('x') } }
  assert.equal(readSectionCollapsed(bad), false)
  assert.doesNotThrow(() => writeSectionCollapsed(bad, true))
  assert.equal(readSectionCollapsed(null), false)
})

test('latestRunId picks the newest run', () => {
  const runs = [
    { id: 'a', updated_at: '2026-12-01T10:00:00Z' },
    { id: 'b', updated_at: '2026-12-03T10:00:00Z' },
    { id: 'c', updated_at: '2026-12-02T10:00:00Z' },
  ]
  assert.equal(latestRunId(runs), 'b')
  assert.equal(latestRunId([]), null)
  assert.equal(latestRunId([{ id: 'x' }, { id: 'y', created_at: '2026-01-01T00:00:00Z' }]), 'y')
})

test('defaults: single run open, multiple only latest; user override wins', () => {
  const one = [{ id: 'a', updated_at: '2026-12-01T10:00:00Z' }]
  assert.equal(isRunOpen(one, 'a'), true)
  const many = [...one, { id: 'b', updated_at: '2026-12-02T10:00:00Z' }]
  assert.equal(isRunOpen(many, 'a'), false)
  assert.equal(isRunOpen(many, 'b'), true)
  assert.equal(isRunOpen(many, 'a', { a: true }), true)
  assert.equal(isRunOpen(many, 'b', { b: false }), false)
  assert.equal(isRunOpen(one, 'a', { a: false }), false)
})

test('collapsedSummary joins non-empty parts', () => {
  assert.equal(collapsedSummary({ headline: '4:32.10', verdictLabel: 'Better' }), '4:32.10 · Better')
  assert.equal(collapsedSummary({ headline: '—', verdictLabel: 'Similar' }), 'Similar')
  assert.equal(collapsedSummary({}), '')
})
