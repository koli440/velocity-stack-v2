// Velodrome suggestion helpers (issue #168): build a minimal payload for add/edit proposals.

export const LINK_FIELDS = ['website_url', 'pricing_url', 'booking_url']
const NUMERIC_FIELDS = ['length_m', 'elevation_m', 'latitude', 'longitude']
const TEXT_FIELDS = ['name', 'location', 'country_code', 'surface', 'notes', ...LINK_FIELDS]

export function normalizeUrl(value) {
  const v = String(value ?? '').trim()
  if (!v) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return u.toString()
  } catch {
    return undefined
  }
}

function normalizeField(field, raw) {
  if (field === 'is_indoor') return typeof raw === 'boolean' ? raw : raw === 'true'
  if (NUMERIC_FIELDS.includes(field)) {
    if (raw === '' || raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  if (LINK_FIELDS.includes(field)) return normalizeUrl(raw)
  const t = String(raw ?? '').trim()
  if (field === 'country_code') return t ? t.toUpperCase() : null
  return t || null
}

// Returns { payload } with only fields that differ from `current` (all provided fields for a new track).
export function buildVelodromePayload(form, current = null) {
  const payload = {}
  for (const field of [...TEXT_FIELDS, ...NUMERIC_FIELDS, 'is_indoor']) {
    if (!(field in form)) continue
    const value = normalizeField(field, form[field])
    if (value === undefined) {
      return { error: LINK_FIELDS.includes(field) ? 'Links must be valid http(s) URLs' : `Invalid value for ${field}` }
    }
    if (current) {
      const before = current[field] ?? null
      const same = NUMERIC_FIELDS.includes(field) && before !== null && value !== null
        ? Number(before) === value
        : before === value
      if (same) continue
    } else if (value === null) {
      continue
    }
    payload[field] = value
  }
  if (!current) {
    if (!payload.name) return { error: 'Name is required' }
    if (payload.length_m == null) return { error: 'Length is required' }
    if (!payload.surface) return { error: 'Surface is required' }
  }
  if (!Object.keys(payload).length) return { error: 'No changes to suggest' }
  return { payload }
}

// Wooden tracks are almost always indoor; flag the unusual combination so mistakes get corrected.
export function surfaceEnvironmentHint(surface, isIndoor) {
  if (String(surface ?? '').trim().toLowerCase() === 'wood' && isIndoor === false) {
    return 'Wooden tracks are usually indoor. Please double-check the environment.'
  }
  return null
}
