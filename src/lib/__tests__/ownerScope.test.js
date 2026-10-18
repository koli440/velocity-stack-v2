import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scopeToOwner, visibleTemplatesFilter } from '../ownerScope.js'

const ME = '11111111-1111-4111-8111-111111111111'

function fakeQuery() {
  const calls = []
  const q = { eq: (c, v) => (calls.push(['eq', c, v]), q), calls }
  return q
}

test('scopeToOwner adds an explicit owner filter (default user_id)', () => {
  const q = scopeToOwner(fakeQuery(), ME)
  assert.deepEqual(q.calls, [['eq', 'user_id', ME]])
  assert.deepEqual(scopeToOwner(fakeQuery(), ME, 'rider_id').calls, [['eq', 'rider_id', ME]])
})

test('scopeToOwner refuses to run without an owner', () => {
  assert.throws(() => scopeToOwner(fakeQuery(), null), /owner id is required/)
  assert.throws(() => scopeToOwner(fakeQuery(), ''), /owner id is required/)
})

test('visibleTemplatesFilter: system + public + own only, never other riders\' private templates', () => {
  assert.equal(visibleTemplatesFilter(ME), `user_id.is.null,visibility.eq.public,user_id.eq.${ME}`)
  assert.equal(visibleTemplatesFilter(null), 'user_id.is.null,visibility.eq.public')
  assert.throws(() => visibleTemplatesFilter('x,user_id.neq.1'), /invalid user id/)
})

// Static guard: coach RLS read policies exist on these tables, so own-account API routes must scope explicitly.
test('own-account API routes scope coach-readable tables by owner explicitly', () => {
  const read = (p) => readFileSync(new URL(`../../app/api/${p}`, import.meta.url), 'utf8')
  assert.match(read('personal-bests/route.js'), /scopeToOwner\(supabase\.from\('personal_bests'\)/)
  assert.match(read('personal-bests/[id]/route.js'), /scopeToOwner\(supabase\.from\('personal_bests'\)/)
  assert.match(read('aero-tests/route.js'), /scopeToOwner\(supabase\.from\('aero_tests'\)/)
  assert.match(read('templates/route.js'), /visibleTemplatesFilter\(user\?\.id\)/)
})
