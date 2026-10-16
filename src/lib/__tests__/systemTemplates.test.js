// Run with: node --test src/lib/__tests__/systemTemplates.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import {
  SYSTEM_TEMPLATES,
  ALL_SYSTEM_TEMPLATES,
  buildManifest,
  buildLtManifest,
  systemTemplateRowSql,
  systemTemplatesUpsertSql,
} from '../systemTemplates.js'
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

const migrationsDir = new URL('../../../supabase/migrations/', import.meta.url)
const allSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(new URL(f, migrationsDir), 'utf8'))
  .join('\n')

test('every sys_ slug seeded by a migration is in the catalogue, and vice versa', () => {
  const seeded = new Set([...allSql.matchAll(/\$q\$(sys_[a-z0-9_]+)\$q\$/g)].map((m) => m[1]))
  const catalogue = new Set(ALL_SYSTEM_TEMPLATES.map((t) => t.slug))
  assert.equal(catalogue.size, ALL_SYSTEM_TEMPLATES.length, 'duplicate slug in catalogue')
  assert.deepEqual([...seeded].filter((s) => !catalogue.has(s)), [])
  assert.deepEqual([...catalogue].filter((s) => !seeded.has(s)), [])
})

test('generated SQL rows match what the migrations seeded', () => {
  for (const t of SYSTEM_TEMPLATES) {
    assert.ok(allSql.includes(systemTemplateRowSql(t, buildManifest(t.dsl))), t.slug)
  }
  for (const t of ALL_SYSTEM_TEMPLATES.filter((x) => !SYSTEM_TEMPLATES.includes(x))) {
    assert.ok(allSql.includes(systemTemplateRowSql(t, buildLtManifest(t.dsl))), t.slug)
  }
})

test('generated upsert is idempotent and never deletes', () => {
  const sql = systemTemplatesUpsertSql(ALL_SYSTEM_TEMPLATES.slice(0, 2))
  assert.match(sql, /ON CONFLICT \(slug\) DO UPDATE/)
  assert.doesNotMatch(sql, /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i)
})
