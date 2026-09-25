/**
 * Pomocné funkce pro detekci úseků z vteřinových dat
 */

export function detectEffortsByCadence(cadenceStream, powerStream, speedStream, minRpm = 125, minDurationSec = 5) {
  if (!cadenceStream || cadenceStream.length === 0) return []

  const efforts = []
  let inEffort = false
  let startIndex = 0

  for (let i = 0; i < cadenceStream.length; i++) {
    const rpm = cadenceStream[i] || 0

    if (!inEffort && rpm >= minRpm) {
      inEffort = true
      startIndex = i
    } else if (inEffort && (rpm < minRpm || i === cadenceStream.length - 1)) {
      const duration = i - startIndex
      if (duration >= minDurationSec) {
        const segCadence = cadenceStream.slice(startIndex, i)
        const segPower = powerStream ? powerStream.slice(startIndex, i) : []
        const segSpeed = speedStream ? speedStream.slice(startIndex, i) : []

        efforts.push({
          id: `cad_${startIndex}`,
          start_sec: startIndex,
          end_sec: i,
          duration_sec: duration,
          max_cadence: Math.max(...segCadence),
          avg_cadence: Math.round(segCadence.reduce((a, b) => a + b, 0) / duration),
          max_power: segPower.length ? Math.max(...segPower) : null,
          max_speed: segSpeed.length ? Math.max(...segSpeed) : null,
          type: 'Sprint / High Cadence',
        })
      }
      inEffort = false
    }
  }

  return efforts
}

export function detectEffortsByTorque(torqueStream, cadenceStream, minTorque = 65, minDurationSec = 3) {
  if (!torqueStream || torqueStream.length === 0) return []

  const efforts = []
  let inEffort = false
  let startIndex = 0

  for (let i = 0; i < torqueStream.length; i++) {
    const t = torqueStream[i] || 0

    if (!inEffort && t >= minTorque) {
      inEffort = true
      startIndex = i
    } else if (inEffort && (t < minTorque || i === torqueStream.length - 1)) {
      const duration = i - startIndex
      if (duration >= minDurationSec) {
        const segTorque = torqueStream.slice(startIndex, i)
        const segCadence = cadenceStream ? cadenceStream.slice(startIndex, i) : []

        efforts.push({
          id: `trq_${startIndex}`,
          start_sec: startIndex,
          end_sec: i,
          duration_sec: duration,
          peak_torque: Math.max(...segTorque),
          avg_torque: Math.round((segTorque.reduce((a, b) => a + b, 0) / duration) * 10) / 10,
          max_cadence: segCadence.length ? Math.max(...segCadence) : null,
          type: 'Standing Start / High Torque',
        })
      }
      inEffort = false
    }
  }

  return efforts
}