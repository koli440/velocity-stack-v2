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
