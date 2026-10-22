// "Return to origin" for the activity detail page. Links that open an activity carry the page they
// were clicked on in a `returnTo` query param, so the back link works on refresh and never relies on
// history. Only same-origin relative paths are accepted (no open redirect).

export const RETURN_TO_PARAM = 'returnTo'
const MAX_LENGTH = 500

const ACTIVITY_PATH = /^(?:\/coach\/[^/?#]+)?\/activities\/[^/?#]+/

/** Returns a safe same-origin relative path, or null. */
export function sanitizeReturnTo(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v || v.length > MAX_LENGTH) return null
  if (v[0] !== '/' || v[1] === '/' || v[1] === '\\') return null
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(v)) return null
  // Reject anything that resolves to another origin or that loops back onto an activity page.
  let url
  try {
    url = new URL(v, 'http://returnto.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'http://returnto.invalid') return null
  if (ACTIVITY_PATH.test(url.pathname)) return null
  return url.pathname + url.search + url.hash
}

/** Adds `returnTo` to an activity detail href. Other hrefs are returned unchanged. */
export function withReturnTo(href, returnTo) {
  if (typeof href !== 'string' || !ACTIVITY_PATH.test(href)) return href
  const safe = sanitizeReturnTo(returnTo)
  if (!safe) return href
  const hashAt = href.indexOf('#')
  const base = hashAt === -1 ? href : href.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : href.slice(hashAt)
  const params = new URLSearchParams(base.includes('?') ? base.slice(base.indexOf('?') + 1) : '')
  params.set(RETURN_TO_PARAM, safe)
  return `${base.split('?')[0]}?${params.toString()}${hash}`
}

/** Current page (path + query) as a returnTo value. */
export function currentReturnTo(pathname, search = '') {
  if (!pathname) return null
  const q = search ? (search.startsWith('?') ? search : `?${search}`) : ''
  return sanitizeReturnTo(`${pathname}${q}`)
}

const LABELS = [
  [/^\/coach\/[^/]+\/calendar$/, 'Calendar'],
  [/^\/coach\/[^/]+\/activities$/, 'Activities'],
  [/^\/coach\/[^/]+\/fitness$/, 'Fitness'],
  [/^\/coach\/[^/]+\/pb-vault$/, 'PB Vault'],
  [/^\/coach\/[^/]+\/physiology$/, 'Physiology'],
  [/^\/coach\/[^/]+\/templates$/, 'Templates'],
  [/^\/coach\/[^/]+$/, 'Athlete overview'],
  [/^\/coach$/, 'Coaching'],
  [/^\/$/, 'Rider telemetry'],
  [/^\/calendar$/, 'Calendar'],
  [/^\/fitness$/, 'Fitness'],
  [/^\/pb-vault$/, 'PB Vault'],
  [/^\/riders\/[^/]+$/, 'Rider profile'],
  [/^\/riders$/, 'Riders'],
  [/^\/gears$/, 'Gear Architect'],
  [/^\/pursuit$/, 'Pursuit Strategist'],
  [/^\/aero-lab$/, 'Aero Lab'],
  [/^\/templates$/, 'Templates'],
  [/^\/velodromes$/, 'Velodromes'],
  [/^\/settings$/, 'Settings'],
  [/^\/whats-new$/, "What's new"],
]

/** Human label of a returnTo path, e.g. '/calendar?month=2027-01' -> 'Calendar'. */
export function returnLabel(returnTo) {
  const safe = sanitizeReturnTo(returnTo)
  if (!safe) return null
  const path = safe.split(/[?#]/)[0].replace(/(.)\/+$/, '$1')
  const hit = LABELS.find(([re]) => re.test(path))
  return hit ? hit[1] : null
}

/**
 * Back link of the activity page. `search` is the page's query string. An origin is only used when it
 * fits the context: inside an athlete's view it must stay in that athlete's pages (a coach never lands
 * on their own pages by accident).
 * @returns {{ href: string, label: string, fromOrigin: boolean }}
 */
export function resolveBack({ search, riderId, fallbackHref, fallbackLabel }) {
  const raw = new URLSearchParams(search || '').get(RETURN_TO_PARAM)
  const safe = sanitizeReturnTo(raw)
  const inScope = safe && (!riderId || safe.split(/[?#]/)[0] === `/coach/${riderId}` || safe.startsWith(`/coach/${riderId}/`))
  if (inScope) {
    const label = returnLabel(safe)
    return { href: safe, label: label ? `Back to ${label}` : 'Back', fromOrigin: true }
  }
  return { href: fallbackHref, label: fallbackLabel, fromOrigin: false }
}
