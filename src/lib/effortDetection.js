// src/lib/effortDetection.js

/**
 * Detection of a sustained Individual Pursuit effort block
 * @param {number[]} wattsStream - array of watts per second
 * @param {number[]} cadenceStream - array of cadence per second
 */
export function detectPursuitEffort(wattsStream = [], cadenceStream = []) {
  if (!wattsStream || wattsStream.length === 0) return null

  // 1. Determine the load threshold: a pursuit is the hardest sustained block on the velodrome in a ride.
  // We estimate the FTP/threshold from the 95% average of the top third of active watts.
  const activeWatts = wattsStream.filter((w) => w > 100)
  if (activeWatts.length < 60) return null

  const sortedWatts = [...activeWatts].sort((a, b) => b - a)
  // The top 20% of values indicates race pace
  const topThreshold = sortedWatts[Math.floor(sortedWatts.length * 0.2)] * 0.75

  let inBlock = false
  let startIdx = 0
  let dropCounter = 0
  const maxAllowedDropSec = 3 // tolerance for a dip/wobble
  let blocks = []

  for (let i = 0; i < wattsStream.length; i++) {
    const w = wattsStream[i] || 0

    if (!inBlock) {
      if (w >= topThreshold) {
        inBlock = true
        startIdx = i
        dropCounter = 0
      }
    } else {
      if (w < topThreshold) {
        dropCounter++
        if (dropCounter > maxAllowedDropSec || i === wattsStream.length - 1) {
          const endIdx = i - dropCounter
          const duration = endIdx - startIdx
          // A track pursuit typically lasts between 70 s (1 km) and 330 s (4 km)
          if (duration >= 60 && duration <= 360) {
            blocks.push({ startIdx, endIdx, duration })
          }
          inBlock = false
        }
      } else {
        dropCounter = 0
      }
    }
  }

  if (blocks.length === 0) return null

  // Select the most dominant block (highest average power x time)
  let bestBlock = null
  let maxScore = 0

  blocks.forEach((b) => {
    const segWatts = wattsStream.slice(b.startIdx, b.endIdx)
    const avgW = segWatts.reduce((acc, val) => acc + val, 0) / b.duration
    const score = avgW * Math.sqrt(b.duration)
    if (score > maxScore) {
      maxScore = score
      bestBlock = { ...b, avgW }
    }
  })

  if (!bestBlock) return null

  const segWatts = wattsStream.slice(bestBlock.startIdx, bestBlock.endIdx)
  const segCad = cadenceStream.slice(bestBlock.startIdx, bestBlock.endIdx)

  // 2. Suggest a distance based on time (typical times in track cycling)
  const dur = bestBlock.duration
  let suggestedDist = 3000 // default for Masters
  let label = '3 km Pursuit (Masters)'

  if (dur < 95) {
    suggestedDist = 1000
    label = '1 km Standing Start'
  } else if (dur < 175) {
    suggestedDist = 2000
    label = '2 km Pursuit'
  } else if (dur >= 175 && dur <= 250) {
    suggestedDist = 3000
    label = '3 km Pursuit (Masters)'
  } else {
    suggestedDist = 4000
    label = '4 km Pursuit (Elite)'
  }

  return {
    id: `pursuit_${bestBlock.startIdx}`,
    start_sec: bestBlock.startIdx,
    end_sec: bestBlock.endIdx,
    duration_sec: dur,
    suggested_distance_m: suggestedDist,
    discipline_label: label,
    avg_power: Math.round(bestBlock.avgW),
    max_power: Math.max(...segWatts),
    avg_cadence: segCad.length ? Math.round(segCad.reduce((a, b) => a + b, 0) / dur) : null,
    max_cadence: segCad.length ? Math.max(...segCad) : null,
    // Calculate average speed purely from time and the suggested distance: (meters / seconds) * 3.6
    calculated_avg_speed_kmh: Math.round(((suggestedDist / dur) * 3.6) * 10) / 10,
  }
}