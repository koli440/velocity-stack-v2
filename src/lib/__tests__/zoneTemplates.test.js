// Run with: node --test src/lib/__tests__/zoneTemplates.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseIntervalDsl, stringifyIntervalDsl } from '../intervalDsl.js'
import { ZONE_SYSTEM_TEMPLATES, ALL_SYSTEM_TEMPLATES, buildLtManifest, systemTemplatesUpsertSql } from '../systemTemplates.js'
import { DSL_GUIDE_EXAMPLES, DSL_BANDS } from '../dslGuide.js'

const sql = readFileSync(new URL('../../../supabase/migrations/20261128000000_power_zone_templates.sql', import.meta.url), 'utf8')

test('zone system templates parse, round-trip and use zone bands', () => {
  assert.ok(ZONE_SYSTEM_TEMPLATES.length >= 3)
  for (const t of ZONE_SYSTEM_TEMPLATES) {
    const p = parseIntervalDsl(t.dsl)
    assert.deepEqual(p.errors, [], t.slug)
    assert.equal(stringifyIntervalDsl(p), t.dsl)
    assert.ok(p.steps.some((s) => s.bandType === 'zone'), t.slug)
    assert.ok(ALL_SYSTEM_TEMPLATES.includes(t))
  }
})

test('migration matches the catalogue exactly and is an idempotent upsert', () => {
  assert.match(sql, /ON CONFLICT \(slug\) DO UPDATE/)
  assert.ok(!/DELETE|DROP/i.test(sql))
  assert.ok(sql.endsWith(systemTemplatesUpsertSql(ZONE_SYSTEM_TEMPLATES)))
  for (const t of ZONE_SYSTEM_TEMPLATES) {
    assert.ok(sql.includes(`$q$${JSON.stringify(buildLtManifest(t.dsl))}$q$::jsonb`), t.slug)
  }
})

test('slugs are unique across the whole catalogue', () => {
  const slugs = ALL_SYSTEM_TEMPLATES.map((t) => t.slug)
  assert.equal(new Set(slugs).size, slugs.length)
})

test('DSL guide documents zone bands', () => {
  assert.ok(DSL_BANDS.some((b) => b.syntax === 'Z3'))
  assert.ok(DSL_GUIDE_EXAMPLES.some((e) => /@ Z3/.test(e.dsl)))
})
