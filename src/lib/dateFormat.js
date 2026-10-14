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
