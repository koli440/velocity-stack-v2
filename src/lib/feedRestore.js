// Restores the Rider telemetry feed (tab, loaded depth, scroll position) after opening an activity
// and coming back. The tab lives in the URL (`?scope=following`) so the activity's returnTo and the
// browser back button agree; depth + scroll live in a short-lived sessionStorage snapshot per tab.

export const SCOPES = ['mine', 'following']
export const SCOPE_PARAM = 'scope'
export const SNAPSHOT_KEY_PREFIX = 'feedRestore:'
export const SNAPSHOT_TTL_MS = 30 * 60 * 1000
const MAX_COUNT = 2000

/** Tab from a query string; unknown/missing values fall back to 'mine'. */
export function scopeFromSearch(search) {
  const v = new URLSearchParams(search || '').get(SCOPE_PARAM)
  return SCOPES.includes(v) ? v : 'mine'
}

/** Feed path for a tab, e.g. '/?scope=following'. The default tab keeps the clean '/' URL. */
export function feedPath(scope) {
  return scope === 'following' ? `/?${SCOPE_PARAM}=following` : '/'
}

export function snapshotKey(scope) {
  return `${SNAPSHOT_KEY_PREFIX}${scope}`
}

export function buildSnapshot({ count, scrollY, now = Date.now() }) {
  return JSON.stringify({ count: Math.max(0, Math.floor(count) || 0), scrollY: Math.max(0, Math.round(scrollY) || 0), at: now })
}

/** Parses a stored snapshot; returns null when missing, malformed, stale or empty. */
export function parseSnapshot(raw, now = Date.now()) {
  if (!raw) return null
  let s
  try {
    s = JSON.parse(raw)
  } catch {
    return null
  }
  if (!s || !Number.isFinite(s.count) || !Number.isFinite(s.scrollY) || !Number.isFinite(s.at)) return null
  if (now - s.at > SNAPSHOT_TTL_MS || now < s.at) return null
  if (s.scrollY <= 0 && s.count <= 0) return null
  return { count: Math.min(Math.floor(s.count), MAX_COUNT), scrollY: s.scrollY }
}

/** Number of further pages needed so that `target` activities are loaded. */
export function pagesToLoad({ loaded, target, pageSize }) {
  if (!(pageSize > 0) || target <= loaded) return 0
  return Math.ceil((target - loaded) / pageSize)
}
