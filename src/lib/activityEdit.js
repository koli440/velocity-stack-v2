// Editing an already uploaded / synced activity (issue #96): validation and update payload.

import { isValidVisibility } from './social.js'
import { parseGear } from './gear.js'

export const MAX_TITLE_LENGTH = 120
export const MAX_DESCRIPTION_LENGTH = 2000

/**
 * Validates the edit form and returns the `activities` update payload.
 * @returns {{ updates: object|null, error: string|null }}
 */
export function buildActivityUpdates({ title, trackId, visibility, chainring, cog, description }) {
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
  const gear = parseGear(chainring, cog)
  if (!gear.valid) return { updates: null, error: gear.error }
  return {
    updates: {
      title: cleanTitle,
      track_id: trackId || null,
      visibility,
      chainring: gear.chainring,
      cog: gear.cog,
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
