// Pure helpers for the header "search my sessions" box.

export const SESSION_SEARCH_MIN_CHARS = 2
export const SESSION_SEARCH_LIMIT = 8
export const SESSION_SEARCH_DEBOUNCE_MS = 300

export function normalizeSearchTerm(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim()
}

export function isSearchable(raw) {
  return normalizeSearchTerm(raw).length >= SESSION_SEARCH_MIN_CHARS
}

// Strips characters that are special to PostgREST `or()` filters and escapes ilike wildcards.
export function escapeIlike(term) {
  return normalizeSearchTerm(term)
    .replace(/[,()"'\\]/g, ' ')
    .replace(/[%_*]/g, (c) => `\\${c === '*' ? '%' : c}`)
    .replace(/\s+/g, ' ')
    .trim()
}

const DATE_PREFIX = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/

const pad = (n) => String(n).padStart(2, '0')

// '2026' | '2026-10' | '2026-10-15' -> { from, to } ISO date bounds (to exclusive), else null.
export function parseDatePrefix(raw) {
  const m = DATE_PREFIX.exec(normalizeSearchTerm(raw))
  if (!m) return null
  const year = Number(m[1])
  const month = m[2] != null ? Number(m[2]) : null
  const day = m[3] != null ? Number(m[3]) : null
  if (year < 1970 || year > 2999) return null
  if (month != null && (month < 1 || month > 12)) return null
  if (day != null && (day < 1 || day > 31)) return null
  let start
  let end
  if (month == null) {
    start = Date.UTC(year, 0, 1)
    end = Date.UTC(year + 1, 0, 1)
  } else if (day == null) {
    start = Date.UTC(year, month - 1, 1)
    end = Date.UTC(year, month, 1)
  } else {
    start = Date.UTC(year, month - 1, day)
    end = start + 86400000
    if (new Date(start).getUTCMonth() !== month - 1) return null
  }
  const iso = (t) => {
    const d = new Date(t)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  return { from: iso(start), to: iso(end) }
}

// Ids of tracks whose name matches the term (case-insensitive substring).
export function matchTrackIds(tracks, term) {
  const needle = normalizeSearchTerm(term).toLowerCase()
  if (!needle) return []
  return (tracks || [])
    .filter((t) => t && t.id != null && String(t.name || '').toLowerCase().includes(needle))
    .map((t) => t.id)
}

/**
 * Describes the query: { date: {from,to}|null, orFilter: string|null }.
 * Date-like terms use a range on activity_date; otherwise title ilike OR track_id in matches.
 */
export function buildSessionSearch(raw, tracks = []) {
  const term = normalizeSearchTerm(raw)
  const date = parseDatePrefix(term)
  if (date) return { date, orFilter: null }
  const pattern = `%${escapeIlike(term)}%`
  const parts = [`title.ilike.${pattern}`]
  const ids = matchTrackIds(tracks, term).filter((id) => /^[\w-]+$/.test(String(id)))
  if (ids.length) parts.push(`track_id.in.(${ids.join(',')})`)
  return { date: null, orFilter: parts.join(',') }
}

export async function searchSessions(client, { userId, term, tracks = [], limit = SESSION_SEARCH_LIMIT }) {
  if (!userId || !isSearchable(term)) return { data: [], error: null }
  const { date, orFilter } = buildSessionSearch(term, tracks)
  let q = client
    .from('activities')
    .select('id, title, activity_date, track_id, tracks(name)')
    .eq('user_id', userId)
  if (date) q = q.gte('activity_date', date.from).lt('activity_date', date.to)
  else q = q.or(orFilter)
  const { data, error } = await q
    .order('activity_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  return { data: data || [], error: error || null }
}
