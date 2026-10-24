// src/lib/intervalsOAuth.js
// Pure Intervals.icu OAuth2 helpers (#312). No network or DB access.
// Docs: https://forum.intervals.icu/t/intervals-icu-oauth-support/2759

import { createHash, randomBytes } from 'node:crypto'

export const INTERVALS_SITE = 'https://intervals.icu'
// ACTIVITY:READ imports rides, CALENDAR:WRITE pushes planned workouts. ACTIVITY:WRITE is not needed.
export const INTERVALS_SCOPES = 'ACTIVITY:READ,CALENDAR:WRITE'
// Registered with Intervals.icu (exact match, no wildcards), so it is fixed.
export const INTERVALS_REDIRECT_URI = 'https://www.velocity-stack.app/api/connections/intervals/callback'
export const INTERVALS_PKCE_COOKIE = 'intervals_pkce'
export const INTERVALS_PKCE_TTL_S = 600

export function isIntervalsOAuthConfigured(env = process.env) {
  return !!(env.INTERVALS_CLIENT_ID && env.INTERVALS_CLIENT_SECRET)
}

export function intervalsRedirectUri(env = process.env) {
  return env.INTERVALS_REDIRECT_URI || INTERVALS_REDIRECT_URI
}

export function createPkcePair(verifier = randomBytes(48).toString('base64url')) {
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function buildIntervalsAuthorizeUrl({ clientId, redirectUri, state, codeChallenge }) {
  const qs = new URLSearchParams({
    client_id: String(clientId),
    redirect_uri: redirectUri,
    scope: INTERVALS_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${INTERVALS_SITE}/oauth/authorize?${qs}`
}

export function intervalsReturnPath(returnTo) {
  return returnTo === 'home' ? '/' : '/settings'
}

/** Token response -> connections columns. Null when the response lacks a token or athlete id. */
export function intervalsTokenToColumns(resp) {
  const id = resp?.athlete?.id
  if (!resp?.access_token || id == null || id === '') return null
  const athleteId = /^\d+$/.test(String(id)) ? `i${id}` : String(id)
  return { external_athlete_id: athleteId, access_token: resp.access_token, athleteName: resp.athlete?.name || null }
}
