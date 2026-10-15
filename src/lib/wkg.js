// Power-to-weight helpers (issue #143). W/kg is always computed from the activity's own weight
// snapshot, never the athlete's current weight; without a weight every helper returns null.

/** Watts per kilogram rounded to 2 decimals, or null when either input is missing/invalid. */
export function wattsPerKg(watts, weightKg) {
  const w = Number(watts)
  const kg = Number(weightKg)
  if (watts == null || weightKg == null || !Number.isFinite(w) || !Number.isFinite(kg) || kg <= 0) return null
  return Math.round((w / kg) * 100) / 100
}

/** "3.45 W/kg", or "—" when unavailable. */
export function formatWkg(watts, weightKg) {
  const v = wattsPerKg(watts, weightKg)
  return v == null ? '—' : `${v.toFixed(2)} W/kg`
}

/** Converts a { '5s': 900, ... } power curve into W/kg values (entries without weight are dropped). */
export function curveToWkg(curve, weightKg) {
  const out = {}
  if (!curve || typeof curve !== 'object') return out
  for (const [k, v] of Object.entries(curve)) {
    const x = wattsPerKg(v, weightKg)
    if (x != null) out[k] = x
  }
  return out
}
