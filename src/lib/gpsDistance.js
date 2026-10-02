// src/lib/gpsDistance.js
//
// Derives speed (km/h) and cumulative distance (m) from a GPS latitude/longitude trace, for
// activities that have a real position fix but no (or a flat/zero) recorded speed stream - e.g.
// a road ride where the rider coasts/freewheels a lot and the device has no wheel speed sensor.
// This complements src/lib/trackGearing.js, which instead derives speed from cadence + gear
// ratio for fixed-gear track bikes with no GPS signal at all (indoor velodrome).
//
// JS mirror of the GPS-derivation logic in api/analyze.py - both must stay numerically in sync
// (see src/app/api/sync/intervals/route.js for the JS caller).

const EARTH_RADIUS_M = 6371000

function toRad(deg) {
  return (deg * Math.PI) / 180
}

/**
 * Great-circle distance between two lat/lng points, in meters.
 */
export function haversineDistanceM(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Builds a per-sample km/h speed stream and total distance from a lat/lng trace, assuming
 * uniform ~1 sample/second spacing (matches the rest of the app's stream-sampling assumptions).
 * Samples with a missing/invalid coordinate are skipped (treated as no movement for that step).
 *
 * @param {Array<number|null>} latStream
 * @param {Array<number|null>} lngStream
 * @returns {{ speedKmh: number[], distanceM: number }}
 */
export function deriveSpeedAndDistanceFromGps(latStream, lngStream) {
  const len = Math.min(latStream?.length || 0, lngStream?.length || 0)
  const speedKmh = new Array(len).fill(0)
  let distanceM = 0
  let prevIdx = -1

  for (let i = 0; i < len; i++) {
    const lat = latStream[i]
    const lng = lngStream[i]
    const valid = typeof lat === 'number' && typeof lng === 'number' && (lat !== 0 || lng !== 0)
    if (!valid) continue

    if (prevIdx >= 0) {
      const dtS = i - prevIdx
      const stepM = haversineDistanceM(latStream[prevIdx], lngStream[prevIdx], lat, lng)
      distanceM += stepM
      speedKmh[i] = dtS > 0 ? Math.round(((stepM / dtS) * 3.6 * 10)) / 10 : 0
    }
    prevIdx = i
  }

  return { speedKmh, distanceM: Math.round(distanceM * 10) / 10 }
}
