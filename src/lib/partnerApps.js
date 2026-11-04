// src/lib/partnerApps.js
// Pure helpers: developer app registration validation, rate-limit decisions, connected-app view models.

import { PARTNER_SCOPES, isValidRedirectUri } from './partnerOAuth.js'

export const MAX_APPS_PER_OWNER = 5
export const MAX_REDIRECT_URIS = 5

export class RegistrationError extends Error {}
const fail = (m) => { throw new RegistrationError(m) }

export function slugify(name) {
  return String(name ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
}

function validHttpsUrl(v, label) {
  if (v == null || v === '') return null
  try {
    const u = new URL(String(v))
    if (u.protocol !== 'https:') fail(`${label} must be an https URL`)
    return u.toString()
  } catch (e) {
    if (e instanceof RegistrationError) throw e
    return fail(`${label} is not a valid URL`)
  }
}

/** @returns normalised { name, description, homepage_url, redirect_uris, scopes, confidential } */
export function validateRegistration(body) {
  const b = body && typeof body === 'object' ? body : {}
  const name = String(b.name ?? '').trim()
  if (name.length < 2 || name.length > 80) fail('Name must be 2-80 characters')
  const description = String(b.description ?? '').trim().slice(0, 500) || null
  const homepage = validHttpsUrl(b.homepage_url, 'Website')
  const uris = [...new Set((Array.isArray(b.redirect_uris) ? b.redirect_uris : String(b.redirect_uris ?? '').split(/\s+/)).map((s) => String(s).trim()).filter(Boolean))]
  if (!uris.length) fail('At least one redirect URI is required')
  if (uris.length > MAX_REDIRECT_URIS) fail(`At most ${MAX_REDIRECT_URIS} redirect URIs`)
  uris.forEach((u) => { if (!isValidRedirectUri(u)) fail(`Redirect URI must be https (or http on localhost): ${u}`) })
  const scopes = [...new Set(Array.isArray(b.scopes) && b.scopes.length ? b.scopes : ['activities:write'])]
  scopes.forEach((s) => { if (!PARTNER_SCOPES.includes(s)) fail(`Unknown scope: ${s}`) })
  return { name, description, homepage_url: homepage, redirect_uris: uris, scopes, confidential: b.confidential !== false }
}

/** Per-minute decision from the hits counted so far (this request included). */
export function minuteDecision(hits, limit, now = Date.now()) {
  if (hits <= limit) return { allowed: true, remaining: Math.max(0, limit - hits) }
  return { allowed: false, remaining: 0, retryAfterS: Math.max(1, 60 - Math.floor((now % 60000) / 1000)) }
}

/** Daily upload cap decision from uploads in the last 24 h (excluding this one). */
export function dayDecision(uploadsLast24h, limit, now = Date.now()) {
  if (uploadsLast24h < limit) return { allowed: true }
  const midnight = new Date(now); midnight.setUTCHours(24, 0, 0, 0)
  return { allowed: false, retryAfterS: Math.max(60, Math.ceil((midnight.getTime() - now) / 1000)) }
}

/** Active (not revoked, not rotated) grants -> one entry per app for the rider's "Connected apps" list. */
export function connectedAppsView(grants, apps) {
  const byId = new Map((apps || []).map((a) => [a.id, a]))
  const out = new Map()
  for (const g of grants || []) {
    if (g.revoked_at || g.rotated_at) continue
    const app = byId.get(g.app_id)
    if (!app) continue
    const prev = out.get(g.app_id)
    const lastUsed = g.last_used_at || null
    if (!prev) {
      out.set(g.app_id, { app_id: app.id, name: app.name, description: app.description, homepage_url: app.homepage_url, scopes: g.scopes, connected_at: g.created_at, last_used_at: lastUsed })
    } else {
      if (g.created_at < prev.connected_at) prev.connected_at = g.created_at
      if (lastUsed && (!prev.last_used_at || lastUsed > prev.last_used_at)) prev.last_used_at = lastUsed
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}
