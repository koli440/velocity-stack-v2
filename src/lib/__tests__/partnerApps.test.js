import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateRegistration, RegistrationError, slugify, minuteDecision, dayDecision, connectedAppsView } from '../partnerApps.js'
import { registerApp, disconnectApp, setAppStatus } from '../server/partnerAdmin.js'
import { hashToken } from '../partnerOAuth.js'

const ok = { name: 'Pedalmania', description: 'Pixel-art cycling', homepage_url: 'https://pedalmania.cc', redirect_uris: ['https://pedalmania.cc/cb'], scopes: ['activities:write'] }
const rejects = (b, re) => assert.throws(() => validateRegistration(b), (e) => e instanceof RegistrationError && re.test(e.message))

test('registration: normalises and validates', () => {
  const r = validateRegistration(ok)
  assert.equal(r.confidential, true)
  assert.deepEqual(r.redirect_uris, ['https://pedalmania.cc/cb'])
  assert.equal(validateRegistration({ ...ok, redirect_uris: 'https://a.example/cb http://localhost:3000/cb', confidential: false }).redirect_uris.length, 2)
  rejects({ ...ok, name: 'x' }, /Name/)
  rejects({ ...ok, homepage_url: 'http://x.example' }, /https/)
  rejects({ ...ok, redirect_uris: [] }, /redirect/i)
  rejects({ ...ok, redirect_uris: ['http://evil.example/cb'] }, /https/)
  rejects({ ...ok, redirect_uris: ['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4', 'https://a/5', 'https://a/6'] }, /At most/)
  rejects({ ...ok, scopes: ['admin'] }, /scope/i)
  assert.equal(slugify('Pedalmania Ünï!'), 'pedalmania-uni')
})

test('rate limit decisions', () => {
  assert.deepEqual(minuteDecision(60, 60), { allowed: true, remaining: 0 })
  const d = minuteDecision(61, 60, Date.parse('2026-11-04T12:00:20Z'))
  assert.equal(d.allowed, false)
  assert.equal(d.retryAfterS, 40)
  assert.equal(dayDecision(499, 500).allowed, true)
  const day = dayDecision(500, 500, Date.parse('2026-11-04T23:00:00Z'))
  assert.equal(day.allowed, false)
  assert.equal(day.retryAfterS, 3600)
})

test('connected apps view hides revoked/rotated grants and merges per app', () => {
  const apps = [{ id: 'a1', name: 'Pedalmania', description: 'd', homepage_url: null }, { id: 'a2', name: 'Other' }]
  const grants = [
    { app_id: 'a1', scopes: ['activities:write'], created_at: '2026-10-01', last_used_at: '2026-11-01' },
    { app_id: 'a1', scopes: ['activities:write'], created_at: '2026-10-05', last_used_at: '2026-11-03' },
    { app_id: 'a1', rotated_at: 'x', created_at: '2026-09-01' },
    { app_id: 'a2', revoked_at: 'x', created_at: '2026-09-01' },
  ]
  const v = connectedAppsView(grants, apps)
  assert.equal(v.length, 1)
  assert.equal(v[0].connected_at, '2026-10-01')
  assert.equal(v[0].last_used_at, '2026-11-03')
  assert.equal('access_token_hash' in v[0], false)
})

function memDb() {
  const t = { developer_apps: [], oauth_grants: [], partner_audit_log: [] }
  const chain = (table, rows) => {
    let filters = []
    let op = 'select'
    let patch
    const api = {
      eq: (c, v) => (filters.push((r) => r[c] === v), api),
      is: (c, v) => (filters.push((r) => (r[c] ?? null) === v), api),
      select: () => api,
      update: (p) => ((op = 'update'), (patch = p), api),
      insert: (r) => {
        const row = { id: `${table}-${rows.length + 1}`, ...r }
        if (table === 'developer_apps' && rows.some((x) => x.slug === row.slug)) return { select: () => ({ single: async () => ({ error: { code: '23505' } }) }) }
        rows.push(row)
        return { select: () => ({ single: async () => ({ data: row }) }), then: (res) => res({ error: null }) }
      },
      then: (res) => {
        const hit = rows.filter((r) => filters.every((f) => f(r)))
        if (op === 'update') hit.forEach((r) => Object.assign(r, patch))
        res({ data: hit, count: hit.length })
      },
    }
    return api
  }
  return { t, from: (table) => chain(table, t[table]) }
}

test('registerApp stores only the secret hash, starts pending and audits', async () => {
  const db = memDb()
  const r = await registerApp(db, 'owner1', validateRegistration(ok))
  assert.equal(r.app.status, 'pending')
  assert.match(r.clientSecret, /^vss_/)
  const row = db.t.developer_apps[0]
  assert.equal(row.client_secret_hash, hashToken(r.clientSecret))
  assert.notEqual(row.client_secret_hash, r.clientSecret)
  assert.equal(db.t.partner_audit_log[0].event, 'app_registered')
  const pub = await registerApp(db, 'owner1', validateRegistration({ ...ok, name: 'Public one', confidential: false }))
  assert.equal(pub.clientSecret, null)
})

test('admin approval and rider disconnect are audited; disconnect only touches own grants', async () => {
  const db = memDb()
  db.t.developer_apps.push({ id: 'a1', status: 'pending' })
  assert.equal(await setAppStatus(db, 'admin1', 'a1', 'approved'), true)
  assert.equal(db.t.developer_apps[0].status, 'approved')
  assert.equal(await setAppStatus(db, 'admin1', 'nope', 'approved'), false)
  db.t.oauth_grants.push({ id: 'g1', user_id: 'u1', app_id: 'a1', revoked_at: null }, { id: 'g2', user_id: 'u2', app_id: 'a1', revoked_at: null })
  assert.equal(await disconnectApp(db, 'u1', 'a1'), 1)
  assert.ok(db.t.oauth_grants[0].revoked_at)
  assert.equal(db.t.oauth_grants[1].revoked_at, null)
  assert.deepEqual(db.t.partner_audit_log.map((l) => l.event), ['app_approved', 'rider_disconnect'])
})
