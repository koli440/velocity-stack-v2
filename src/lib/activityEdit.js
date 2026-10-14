// Editing an already uploaded / synced activity (issue #96): validation and update payload.

import { isValidVisibility } from './social.js'

export const MAX_TITLE_LENGTH = 120
export const MAX_DESCRIPTION_LENGTH = 2000

// Common track gearings offered by the gear selector (chainring × cog).
export const GEAR_PRESETS = Object.freeze(
  [
    [48, 15], [49, 15], [50, 15], [51, 15], [52, 15],
    [52, 14], [54, 14], [55, 14], [56, 14], [58, 14], [60, 14],
    [62, 14], [64, 14], [66, 14], [68, 14],
  ].map(([chainring, cog]) => ({ value: `${chainring}x${cog}`, label: `${chainring}×${cog}`, chainring, cog }))
)

export function gearValue(chainring, cog) {
  return chainring && cog ? `${chainring}x${cog}` : ''
}

// Options for the select; keeps the activity's current gear selectable even if it is not a preset.
export function gearOptions(current) {
  const options = [...GEAR_PRESETS]
  if (current && !options.some((o) => o.value === current)) {
    const m = /^(\d+)x(\d+)$/.exec(current)
    if (m) options.unshift({ value: current, label: `${m[1]}×${m[2]}`, chainring: Number(m[1]), cog: Number(m[2]) })
  }
  return options
}

export function parseGearValue(value) {
  const m = /^(\d+)x(\d+)$/.exec(value || '')
  if (!m) return { chainring: null, cog: null }
  return { chainring: Number(m[1]), cog: Number(m[2]) }
}

/**
 * Validates the edit form and returns the `activities` update payload.
 * @returns {{ updates: object|null, error: string|null }}
 */
export function buildActivityUpdates({ title, trackId, visibility, gear, description }) {
  const cleanTitle = String(title ?? '').trim()
  if (!cleanTitle) return { updates: null, error: 'Activity name is required' }
  if (cleanTitle.length > MAX_TITLE_LENGTH) {
    return { updates: null, error: `Activity name must be at most ${MAX_TITLE_LENGTH} characters` }
  }
  if (!isValidVisibility(visibility)) return { updates: null, error: 'Invalid privacy setting' }
  const cleanDescription = String(description ?? '').trim()
  if (cleanDescription.length > MAX_DESCRIPTION_LENGTH) {
    return { updates: null, error: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters` }
  }
  const { chainring, cog } = parseGearValue(gear)
  return {
    updates: {
      title: cleanTitle,
      track_id: trackId || null,
      visibility,
      chainring,
      cog,
      description: cleanDescription || null,
    },
    error: null,
  }
}

export async function updateActivity(client, activityId, input) {
  if (!activityId) return { updates: null, error: new Error('Missing activity id') }
  const { updates, error: validationError } = buildActivityUpdates(input)
  if (validationError) return { updates: null, error: new Error(validationError) }
  const { error } = await client.from('activities').update(updates).eq('id', activityId)
  return { updates: error ? null : updates, error: error || null }
}
