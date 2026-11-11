// Absolute watts for pushed workouts: the targets are computed from the rider's Velocity Stack FTP, lactate
// thresholds (LT1/LT2) and zone percentages, so they do not depend on what is configured on the other platform/device.
import { computeZones, zoneBandWatts, FTP_LT1_FRACTION, FTP_LT2_FRACTION } from './powerZones.js'

const pos = (n) => (Number(n) > 0 ? Number(n) : null)

/**
 * @param {{ ftp?: number|null, lt?: { lt1Power?: number|null, lt2Power?: number|null }|null, pcts?: number[]|null }} [input]
 * @returns {{ ftp: number|null, lt1: number|null, lt2: number|null, ltEstimated: boolean, zones: object|null, key: string }}
 */
export function buildPowerBasis({ ftp = null, lt = null, pcts = null } = {}) {
  const f = pos(ftp) ? Math.round(Number(ftp)) : null
  const lt1Known = pos(lt?.lt1Power)
  const lt2Known = pos(lt?.lt2Power)
  const lt1 = lt1Known ?? (f ? f * FTP_LT1_FRACTION : null)
  const lt2 = lt2Known ?? (f ? f * FTP_LT2_FRACTION : null)
  const zones = lt1 && lt2 ? computeZones({ lt: { lt1Power: lt1Known, lt2Power: lt2Known }, ftp: f, pcts }) : null
  return {
    ftp: f,
    lt1,
    lt2,
    ltEstimated: lt1Known == null || lt2Known == null,
    zones,
    key: JSON.stringify([f, lt1Known, lt2Known, zones?.pcts ?? null]),
  }
}

/** Basis from an FTP only (default zone model). */
export const basisFromFtp = (ftp) => buildPowerBasis({ ftp })

const scale = (base, p) => (p == null ? null : Math.round((base * p) / 100))

/**
 * Watts window of a relative DSL band, or null when the rider's numbers are missing.
 * @returns {{ min: number|null, max: number|null, warning: string|null } | null}
 */
export function bandToWatts(step, basis) {
  const { bandType: t, powerMin: lo, powerMax: hi } = step
  if (!basis) return null
  switch (t) {
    case 'pct_ftp':
      return basis.ftp ? { min: scale(basis.ftp, lo), max: scale(basis.ftp, hi), warning: null } : null
    case 'pct_lt2':
      return basis.lt2 ? { min: scale(basis.lt2, lo), max: scale(basis.lt2, hi), warning: basis.ltEstimated && !basis.ftp ? null : basis.ltEstimated ? 'LT2 targets were sent as watts from your FTP (no LT2 power set in Velocity Stack).' : null } : null
    case 'pct_lt1':
      return basis.lt1 ? { min: scale(basis.lt1, lo), max: scale(basis.lt1, hi), warning: basis.ltEstimated ? 'LT1 targets were sent as watts using 75% of your FTP (no LT1 power set in Velocity Stack).' : null } : null
    case 'zone': {
      const w = zoneBandWatts(basis.zones, { powerMin: lo, powerMax: hi })
      return w ? { min: w.min, max: w.max, warning: null } : null
    }
    default:
      return null
  }
}

export const MISSING_POWER_NOTE = 'Set your FTP (or LT1/LT2 power) in your Velocity Stack profile to send watts targets.'

// Pushed hashes carry the basis key after "~": a change of FTP/LT/zones re-sends the workout, while the browser
// (which only knows the workout) compares the part before "~".
export const withBasis = (hash, basis) => (basis?.key ? `${hash}~${basis.key.length > 40 ? hashKey(basis.key) : basis.key}` : hash)
export const hashBase = (stored) => String(stored ?? '').split('~')[0]

function hashKey(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
