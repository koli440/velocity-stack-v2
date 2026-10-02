// src/lib/trackGearing.js
//
// Track (velodrome) bikes are fixed-gear with no freewheel and frequently no GPS/wheel speed
// sensor at all - devices just report a flat 0.0 speed for every record. When that happens we
// derive speed from cadence + the rider's gear ratio instead, using the same "gear inches"
// convention already used by calcGearInches() in src/app/activities/[id]/page.js.
//
// This is the JS mirror of gear_development_m()/analyze_fit_file() in api/analyze.py - both
// implementations must stay numerically in sync (see src/app/api/sync/intervals/route.js for the
// Intervals.icu degraded-fallback caller, and api/analyze.py for the primary .fit upload path).
//
// gearInches()/speedAtCadence() below generalize the same math to an arbitrary wheel size for the
// standalone "Gear Architect" calculator (src/app/gears/page.js), migrated from v1's
// pages/20_gears.py.

// Standard 700c track tubular wheel diameter in inches, matching TRACK_WHEEL_DIAMETER_INCHES in
// api/analyze.py and the constant baked into calcGearInches().
export const TRACK_WHEEL_DIAMETER_INCHES = 26.8

/**
 * Distance (in meters) the wheel travels per crank revolution for a fixed-gear track bike.
 * @param {number} chainring - front chainring tooth count
 * @param {number} cog - rear cog tooth count
 * @param {number} [wheelDiameterInches]
 * @returns {number}
 */
export function gearDevelopmentM(chainring, cog, wheelDiameterInches = TRACK_WHEEL_DIAMETER_INCHES) {
  const gearInches = (Number(chainring) / Number(cog)) * wheelDiameterInches
  return gearInches * Math.PI * 0.0254
}

/**
 * Derives a km/h speed stream from a cadence (RPM) stream and gear ratio, for activities whose
 * recorded speed stream has no real signal (every sample is 0 - no speed sensor in the file).
 * @param {number[]} cadenceStream
 * @param {number} chainring
 * @param {number} cog
 * @returns {number[]}
 */
export function deriveSpeedFromCadence(cadenceStream, chainring, cog) {
  const developmentM = gearDevelopmentM(chainring, cog)
  return (cadenceStream || []).map((c) =>
    c > 0 ? Math.round(developmentM * (c / 60) * 3.6 * 10) / 10 : 0
  )
}

/**
 * @param {number[]|null} speedStream
 * @returns {boolean} true if at least one sample shows real motion (not a flat all-zero stream)
 */
export function hasSpeedSignal(speedStream) {
  return (speedStream || []).some((v) => (v || 0) > 0)
}

/**
 * Gear inches for an arbitrary wheel size - the "Gear Architect" calculator (migrated from v1's
 * pages/20_gears.py) lets riders pick any wheel size, unlike the fixed track-wheel helpers above.
 * @param {number} chainring - front chainring tooth count
 * @param {number} cog - rear cog tooth count
 * @param {number} wheelSizeInches - wheel diameter in inches
 * @returns {number}
 */
export function gearInches(chainring, cog, wheelSizeInches) {
  return (Number(chainring) / Number(cog)) * Number(wheelSizeInches)
}

/**
 * Speed (km/h) at a given cadence (RPM) for an arbitrary gear inches value. Mirrors v1's
 * speed_at_cadence_kmh = (gear_inches * 0.0254 * pi * cadence * 60) / 1000.
 * @param {number} gearInchesValue
 * @param {number} cadence - RPM
 * @returns {number}
 */
export function speedAtCadence(gearInchesValue, cadence) {
  return (Number(gearInchesValue) * 0.0254 * Math.PI * Number(cadence) * 60) / 1000
}
