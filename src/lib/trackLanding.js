// Pure helpers for the public /track landing page (Google Ads campaign for track riders and coaches).
import { SITE_URL, SITE_NAME } from './seo.js'

export const TRACK_PATH = '/track'
export const isLandingPath = (pathname) => pathname === TRACK_PATH || pathname === `${TRACK_PATH}/`

// Appends the visitor's query string (utm_*, gclid, ...) to an in-app href untouched.
// Existing query/hash on the href are kept; the visitor's params are added after them.
export function carryQuery(href, search) {
  const extra = String(search ?? '').replace(/^\?/, '')
  if (!extra || typeof href !== 'string' || !href.startsWith('/')) return href
  const hashAt = href.indexOf('#')
  const base = hashAt === -1 ? href : href.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : href.slice(hashAt)
  return `${base}${base.includes('?') ? '&' : '?'}${extra}${hash}`
}

export const TRACK_TITLE = 'Track Cycling Analysis App'
export const TRACK_DESCRIPTION =
  'Built for track cycling: know the gear you really rode and analyse every interval. Gear Architect, template analysis, race tagging and coaching.'

export function trackJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: `${SITE_URL}${TRACK_PATH}`,
    description: TRACK_DESCRIPTION,
    applicationCategory: 'SportsApplication',
    operatingSystem: 'Any',
    audience: { '@type': 'Audience', audienceType: 'Track cyclists and cycling coaches' },
  }
}

// Escaped so the JSON can never close the surrounding script tag.
export const jsonLdString = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c')
