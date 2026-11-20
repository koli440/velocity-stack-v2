// src/lib/swim.js
//
// Swim presentation helpers. Swims are shown in metres and as pace per 100 m, never km/h or watts.

/** { value, unit } of a swim distance: whole metres up to 9,999 m, kilometres (2 decimals) beyond; null without a distance. */
export function formatSwimDistance(meters) {
  const m = Number(meters)
  if (!Number.isFinite(m) || m <= 0) return null
  if (m >= 10000) return { value: (m / 1000).toFixed(2), unit: 'km' }
  return { value: Math.round(m).toLocaleString('en-US'), unit: 'm' }
}

/** Pace per 100 m as "m:ss" from distance and time in seconds; null when either is missing or implausible. */
export function formatSwimPace(meters, seconds) {
  const m = Number(meters)
  const s = Number(seconds)
  if (!(m >= 25) || !(s > 0)) return null
  const per100 = Math.round((s / m) * 100)
  if (per100 < 20 || per100 > 1200) return null
  return `${Math.floor(per100 / 60)}:${String(per100 % 60).padStart(2, '0')}`
}
