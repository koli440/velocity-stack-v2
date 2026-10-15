// Run with: node --test src/lib/__tests__/systemTemplates.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SYSTEM_TEMPLATES, buildManifest } from '../systemTemplates.js'
import { parseIntervalDsl, stringifyIntervalDsl } from '../intervalDsl.js'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20261101000000_system_templates_catalog.sql', import.meta.url),
  'utf8',
)

test('catalog slugs are unique and cover road + track', () => {
  const slugs = SYSTEM_TEMPLATES.map((t) => t.slug)
  assert.equal(new Set(slugs).size, slugs.length)
  assert.ok(SYSTEM_TEMPLATES.some((t) => t.category === 'road'))
  assert.ok(SYSTEM_TEMPLATES.some((t) => t.category === 'track'))
})

for (const t of SYSTEM_TEMPLATES) {
  test(`${t.slug}: DSL parses and round-trips`, () => {
    const parsed = parseIntervalDsl(t.dsl)
    assert.deepEqual(parsed.errors, [])
    assert.equal(stringifyIntervalDsl(parsed), t.dsl)
  })

  test(`${t.slug}: migration row matches catalog`, () => {
    const manifest = buildManifest(t.dsl)
    assert.ok(migration.includes(`$q$${t.slug}$q$`))
    assert.ok(migration.includes(`$q$${JSON.stringify(manifest)}$q$::jsonb`))
    assert.ok(migration.includes(`$q$${t.dsl}$q$`))
  })
}

test('migration upserts on slug', () => {
  assert.match(migration, /ON CONFLICT \(slug\) DO UPDATE/)
})
