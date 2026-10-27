import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isPublicToolPath, isPublicContentPath, PUBLIC_TOOL_PATHS } from '../publicPaths.js'
import { registerHref, loginHref, shouldShowCatch, CATCH_THRESHOLD } from '../signupCatch.js'
import { carryQuery } from '../trackLanding.js'
import { PUBLIC_PATHS, PRIVATE_PATHS } from '../seo.js'

test('Gear Architect and Pursuit Strategist are public tool paths', () => {
  assert.deepEqual(PUBLIC_TOOL_PATHS, ['/gears', '/pursuit'])
  for (const p of ['/gears', '/pursuit', '/pursuit/', '/gears/x']) assert.ok(isPublicToolPath(p), p)
  for (const p of ['/pursuits', '/pb-vault', '/gearsx', '/', '/aero-lab']) assert.ok(!isPublicToolPath(p), p)
  assert.ok(!isPublicContentPath('/pursuit'))
})

test('tools are indexable and no longer private', () => {
  for (const p of PUBLIC_TOOL_PATHS) {
    assert.ok(PUBLIC_PATHS.includes(p))
    assert.ok(!PRIVATE_PATHS.some((x) => p.startsWith(x)))
  }
})

test('auth links return to the same tool and keep UTM params', () => {
  assert.equal(registerHref('/pursuit'), '/register?next=%2Fpursuit')
  assert.equal(loginHref('/gears'), '/login?next=%2Fgears')
  assert.equal(carryQuery(registerHref('/gears'), '?utm_source=g&gclid=1'), '/register?next=%2Fgears&utm_source=g&gclid=1')
})

test('unsafe next values are dropped', () => {
  for (const bad of ['//evil.com', 'https://evil.com', '/login', '', null]) {
    assert.equal(registerHref(bad), '/register')
  }
})

test('catch banner needs use, no dismissal and no session', () => {
  const base = { interactions: CATCH_THRESHOLD, dismissed: false, signedIn: false }
  assert.ok(shouldShowCatch(base))
  assert.ok(!shouldShowCatch({ ...base, interactions: 0 }))
  assert.ok(!shouldShowCatch({ ...base, dismissed: true }))
  assert.ok(!shouldShowCatch({ ...base, signedIn: true }))
})

test('anonymous reads of tool reference tables are allowed by RLS', () => {
  const sql = fs.readdirSync('supabase/migrations').map((f) => fs.readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
  assert.match(sql, /CREATE POLICY "tracks_read_all" ON public\.tracks FOR SELECT TO anon, authenticated USING \(TRUE\)/)
  assert.match(sql, /CREATE POLICY "Lookups are readable" ON public\.disciplines FOR SELECT USING \(true\)/)
})

test('nav items: public ones stay open, the rest are gated for visitors', async () => {
  const { NAV_ITEMS, isNavItemPublic, isNavItemLocked } = await import('../navigation.js')
  const publicKeys = NAV_ITEMS.filter(isNavItemPublic).map((i) => i.key)
  assert.deepEqual(publicKeys, ['home', 'gears', 'pursuit', 'velodromes', 'about'])
  const gated = NAV_ITEMS.filter((i) => isNavItemLocked(i, false)).map((i) => i.key)
  assert.deepEqual(gated, ['calendar', 'fitness', 'pb-vault', 'riders', 'aero-lab', 'templates', 'feedback', 'settings'])
  assert.equal(NAV_ITEMS.filter((i) => isNavItemLocked(i, true)).length, 0)
})

test('public content and tool pages keep the app menu for visitors', () => {
  const shell = fs.readFileSync('src/components/AppShell.js', 'utf8')
  assert.match(shell, /signedIn=\{!!user\}/)
  assert.doesNotMatch(shell, /isPublicContentPath\(pathname\) && \(checkingAuth/)
  assert.ok(fs.readFileSync('src/lib/iconSet.js', 'utf8').includes('lock:'))
})
