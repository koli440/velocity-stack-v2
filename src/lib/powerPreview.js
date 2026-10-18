// Persisted power-over-time preview for hero cards: the ride's 1 Hz watts downsampled into
// ~80 average buckets so the feed never needs the heavy `time_series` blob.
// Mirrors public.build_power_preview() in the SQL migration.

export const POWER_PREVIEW_POINTS = 80

/**
 * @param {unknown} watts 1 Hz watts samples
 * @returns {{ kind: 'power', step_s: number, values: number[] } | { kind: 'none' }}
 */
export function buildPowerPreview(watts, maxPoints = POWER_PREVIEW_POINTS) {
  const samples = Array.isArray(watts) ? watts.filter((w) => typeof w === 'number' && Number.isFinite(w)) : []
  if (samples.length < 10 || !samples.some((w) => w > 0)) return { kind: 'none' }

  const step = Math.ceil(samples.length / maxPoints)
  const values = []
  for (let i = 0; i < samples.length; i += step) {
    const chunk = samples.slice(i, i + step)
    values.push(Math.max(0, Math.round(chunk.reduce((a, b) => a + b, 0) / chunk.length)))
  }
  return { kind: 'power', step_s: step, values }
}

function formatElapsed(sec) {
  const m = Math.round(sec / 60)
  if (m < 90) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${String(m % 60).padStart(2, '0')}`
}

/** Chart rows `{ t, label, power }` (t = elapsed seconds) from a stored preview, or null. */
export function powerPreviewSeries(preview) {
  if (!preview || preview.kind !== 'power' || !Array.isArray(preview.values) || !preview.values.length) return null
  const step = Number(preview.step_s) > 0 ? Number(preview.step_s) : 1
  return preview.values.map((power, i) => ({ t: i * step, label: formatElapsed(i * step), power }))
}
