import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  buildIntervalsAuthorizeUrl,
  createPkcePair,
  intervalsTokenToColumns,
  isIntervalsOAuthConfigured,
  INTERVALS_SCOPES,
} from '../intervalsOAuth.js'
import {
  intervalsAuthHeader,
  intervalsPathAthlete,
  exchangeIntervalsCode,
  revokeIntervalsToken,
  createIntervalsProvider,
} from '../server/intervalsProvider.js'

test('PKCE challenge is the S256 of the verifier', () => {
  const { verifier, challenge } = createPkcePair()
  assert.ok(verifier.length >= 43 && verifier.length <= 128)
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'))
})

test('authorize URL carries scopes, state and PKCE', () => {
  const u = new URL(buildIntervalsAuthorizeUrl({ clientId: 'c', redirectUri: 'https://x/cb', state: 's', codeChallenge: 'ch' }))
  assert.equal(u.origin + u.pathname, 'https://intervals.icu/oauth/authorize')
  assert.equal(u.searchParams.get('scope'), INTERVALS_SCOPES)
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(u.searchParams.get('state'), 's')
})

test('token response maps to columns; numeric athlete ids get the i prefix', () => {
  assert.deepEqual(intervalsTokenToColumns({ access_token: 't', athlete: { id: '2049151', name: 'A' } }), {
    external_athlete_id: 'i2049151',
    access_token: 't',
    athleteName: 'A',
  })
  assert.equal(intervalsTokenToColumns({ access_token: 't' }), null)
  assert.equal(isIntervalsOAuthConfigured({ INTERVALS_CLIENT_ID: 'a' }), false)
})

test('auth header and athlete path depend on the credential type', () => {
  assert.equal(intervalsAuthHeader('k', 'tok'), 'Bearer tok')
  assert.match(intervalsAuthHeader('k'), /^Basic /)
  assert.equal(intervalsPathAthlete('i1', 'tok'), '0')
  assert.equal(intervalsPathAthlete('i1', null), 'i1')
})

test('exchange posts the code, verifier and secret as form data', async () => {
  let call
  const fetchImpl = async (url, init) => {
    call = { url, init }
    return { ok: true, json: async () => ({ access_token: 't' }) }
  }
  await exchangeIntervalsCode({
    code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb',
    env: { INTERVALS_CLIENT_ID: 'id', INTERVALS_CLIENT_SECRET: 'sec' }, fetchImpl,
  })
  assert.equal(call.url, 'https://intervals.icu/api/oauth/token')
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.body.get('code_verifier'), 'v')
  assert.equal(call.init.body.get('client_secret'), 'sec')
})

test('revoke calls disconnect-app with Bearer; no token is a no-op', async () => {
  let call
  const ok = await revokeIntervalsToken('tok', async (url, init) => ((call = { url, init }), { ok: true }))
  assert.ok(ok)
  assert.equal(call.init.method, 'DELETE')
  assert.equal(call.init.headers.Authorization, 'Bearer tok')
  assert.equal(await revokeIntervalsToken(null), false)
})

test('OAuth provider lists activities for athlete 0', async () => {
  let url
  const p = createIntervalsProvider({
    athleteId: 'i1', accessToken: 'tok',
    fetchImpl: async (u) => ((url = u), { ok: true, json: async () => [] }),
  })
  await p.listActivities({ oldest: '2027-01-01' })
  assert.match(url, /\/athlete\/0\/activities/)
})
