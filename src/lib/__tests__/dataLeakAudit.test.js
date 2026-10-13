import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const dir = new URL('../../../supabase/migrations/', import.meta.url)
const sql = readFileSync(new URL('20261016000000_data_leak_audit.sql', dir), 'utf8')

test('raw-activity-files is forced private with owner-only per-operation policies', () => {
  assert.match(sql, /ON CONFLICT \(id\) DO UPDATE SET public = FALSE/)
  for (const op of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    assert.match(sql, new RegExp(`raw_files_${op.toLowerCase()}_own" ON storage\\.objects FOR ${op} TO authenticated`))
  }
  const policies = sql.match(/CREATE POLICY "raw_files_[\s\S]*?;\n/g)
  assert.equal(policies.length, 4)
  for (const p of policies) assert.match(p, /auth\.uid\(\)::text = \(storage\.foldername\(name\)\)\[1\]/)
  assert.ok(!/TO anon|TO public/.test(policies.join('')))
})

test('activity_curves and tracks get RLS; curves are owner-only', () => {
  assert.match(sql, /ALTER TABLE public\.activity_curves ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public\.activity_curves FROM anon/)
  assert.equal((sql.match(/a\.user_id = auth\.uid\(\)/g) || []).length, 5)
  assert.match(sql, /ALTER TABLE public\.tracks ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON public\.tracks/)
})

test('every user-data table created in migrations has RLS enabled somewhere', () => {
  const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n')
  const tables = [...all.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map((m) => m[1])
  for (const t of new Set(tables)) {
    assert.match(all, new RegExp(`public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`), `${t} lacks RLS`)
  }
})
