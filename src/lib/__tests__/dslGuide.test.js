// Run with: node --test src/lib/__tests__/dslGuide.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIntervalDsl } from '../intervalDsl.js'
import { DSL_GUIDE_EXAMPLES, DSL_COMMON_MISTAKES } from '../dslGuide.js'

test('every guide example parses without errors', () => {
  for (const ex of DSL_GUIDE_EXAMPLES) {
    assert.deepEqual(parseIntervalDsl(ex.dsl).errors, [], ex.title)
  }
})

test('every "common mistake" example is actually rejected', () => {
  for (const m of DSL_COMMON_MISTAKES) {
    assert.ok(parseIntervalDsl(m.dsl).errors.length > 0, m.dsl)
  }
})

import { readFileSync } from 'node:fs'
import { DSL_OPTIONS, DSL_BANDS } from '../dslGuide.js'
import { BAND_SUFFIXES } from '../intervalDsl.js'
import { SUMMARY_METRIC_IDS } from '../summaryMetrics.js'
import { LEGACY_PATTERN_NAMES, LEGACY_OPTIONS, LEGACY_PATTERN_OPTIONS } from '../legacyPatterns.js'
import { LEGACY_TEMPLATE_DSL } from '../systemTemplates.js'

const docs = readFileSync(new URL('../../../docs/template-dsl.md', import.meta.url), 'utf8')
const guideText = JSON.stringify([DSL_OPTIONS, DSL_BANDS])
const has = (text, token) => new RegExp(`(^|[^a-z0-9_])${token.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}($|[^a-z0-9_])`, 'i').test(text)

for (const [name, text] of [['guide', guideText], ['docs/template-dsl.md', docs]]) {
  test(`${name} mentions every parser metric, band unit, pattern and pattern option`, () => {
    for (const id of SUMMARY_METRIC_IDS) assert.ok(has(text, id), `metric ${id}`)
    for (const suffix of Object.values(BAND_SUFFIXES)) assert.ok(text.includes(suffix), `band ${suffix}`)
    for (const p of LEGACY_PATTERN_NAMES) assert.ok(has(text, p), `pattern ${p}`)
    for (const o of LEGACY_OPTIONS) assert.ok(text.includes(o.name), `option ${o.name}`)
  })
}

test('legacy pattern option table only references defined options', () => {
  const names = new Set(LEGACY_OPTIONS.map((o) => o.name))
  for (const [p, opts] of Object.entries(LEGACY_PATTERN_OPTIONS)) {
    assert.ok(LEGACY_PATTERN_NAMES.includes(p), p)
    for (const o of opts) assert.ok(names.has(o), `${p}: ${o}`)
  }
})

test('every DSL example in docs/template-dsl.md parses', () => {
  const blocks = [...docs.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1])
  let checked = 0
  for (const block of blocks) {
    for (const chunk of block.split(/\n\s*\n/)) {
      if (!/^\s*(\d+x|\d+\s+sets\s+of|pattern\s)/i.test(chunk)) continue
      assert.deepEqual(parseIntervalDsl(chunk.trim()).errors, [], chunk)
      checked++
    }
  }
  assert.ok(checked >= 15)
})

test('legacy template DSL equivalents parse', () => {
  for (const [slug, dsl] of Object.entries(LEGACY_TEMPLATE_DSL)) {
    assert.deepEqual(parseIntervalDsl(dsl).errors, [], slug)
  }
})
