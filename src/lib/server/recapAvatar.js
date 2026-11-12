// Fetches an (already allowlisted) avatar for the OG renderer as a data URI, with a timeout, content-type and size cap.
// Any failure returns null so the image falls back to initials instead of failing the whole response.
export const AVATAR_FETCH_TIMEOUT_MS = 3000
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const TYPES = ['image/png', 'image/jpeg']

export async function fetchAvatarDataUri(url, { fetchImpl = fetch, timeoutMs = AVATAR_FETCH_TIMEOUT_MS, maxBytes = AVATAR_MAX_BYTES } = {}) {
  if (!url) return null
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store' })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!TYPES.includes(type)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > maxBytes) return null
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}
