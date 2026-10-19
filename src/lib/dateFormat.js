// Locale-aware date helpers: dates follow the user's browser locale (cs-CZ → "14. 10. 2026").
// Server render falls back to cs-CZ so output is stable.
const FALLBACK_LOCALE = 'cs-CZ'

export function userLocale() {
  if (typeof navigator === 'undefined') return FALLBACK_LOCALE
  return navigator.languages?.[0] || navigator.language || FALLBACK_LOCALE
}

function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDate(value, options) {
  const d = toDate(value)
  return d ? d.toLocaleDateString(userLocale(), options) : ''
}

export function formatDateTime(value, options) {
  const d = toDate(value)
  return d ? d.toLocaleString(userLocale(), options) : ''
}

export function formatTime(value, options = { hour: '2-digit', minute: '2-digit' }) {
  const d = toDate(value)
  return d ? d.toLocaleTimeString(userLocale(), options) : ''
}

export function formatNumber(value, options) {
  return Number(value).toLocaleString(userLocale(), options)
}

const MS_PER_DAY = 86400000

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Relative label for the last 7 days (Today / Yesterday / weekday), else "12 Oct 2026".
export function relativeDateLabel(value, { now = new Date(), locale = userLocale() } = {}) {
  const d = toDate(value)
  if (!d) return ''
  const days = Math.round((startOfDay(now) - startOfDay(d)) / MS_PER_DAY)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days > 1 && days < 7) return d.toLocaleDateString(locale, { weekday: 'long' })
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

// "Today · 07:30"
export function relativeDateTime(value, { now = new Date(), locale = userLocale() } = {}) {
  const d = toDate(value)
  if (!d) return ''
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return `${relativeDateLabel(d, { now, locale })} · ${time}`
}

// "Sunday, 19 October 2026 · 07:30" for tooltips and the detail header.
export function fullDateTime(value, { locale = userLocale() } = {}) {
  const d = toDate(value)
  if (!d) return ''
  const date = d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
}

// Big day number and short uppercase month for the calendar tile.
export function calendarTileParts(value, { locale = userLocale() } = {}) {
  const d = toDate(value)
  if (!d) return null
  return { day: String(d.getDate()), month: d.toLocaleDateString(locale, { month: 'short' }).replace(/\.$/, '').toUpperCase() }
}
