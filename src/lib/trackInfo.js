// Researched velodrome info (see docs/velodrome-research/PROCESS.md). Pure helpers shared by the page and JSON-LD.
// Pages for tracks without researched data must render exactly as before.

export const isClosed = (t) => t?.operating_status === 'closed'

const money = (n, currency) => {
  const v = Number(n)
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v)
  } catch {
    return `${currency} ${v}`
  }
}

// "£12 – £47", "from $10", "€15"; null when no usable price. Always accompanied by a "check their site" note in the UI.
export function formatPriceRange(t) {
  if (!t || !t.price_currency || isClosed(t)) return null
  const min = t.price_min == null ? null : Number(t.price_min)
  const max = t.price_max == null ? null : Number(t.price_max)
  if (min == null && max == null) return null
  if (min != null && max != null) return min === max ? money(min, t.price_currency) : `${money(min, t.price_currency)} – ${money(max, t.price_currency)}`
  return min != null ? `from ${money(min, t.price_currency)}` : `up to ${money(max, t.price_currency)}`
}

// schema.org priceRange is free text; only emitted when a range exists.
export const priceRangeLd = (t) => {
  const r = formatPriceRange(t)
  return r ? r.replace(/ – /g, '-') : null
}

// Phone is only ever shown/exported when flagged as an organisational (venue-level) contact.
export const publicPhone = (t) => (t?.phone && t.contact_is_organisational ? t.phone : null)

export const openingHoursLd = (t) => {
  if (!t?.opening_hours_spec || isClosed(t)) return null
  const parts = t.opening_hours_spec.split(';').map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts : null
}

export const hasTrackInfo = (t) =>
  !!(t && (t.operator || t.year_built || t.opening_hours || formatPriceRange(t) || isClosed(t) || t.info_verified_at))

export const formatVerifiedDate = (d) => {
  if (!d) return null
  const s = String(d).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
