// Editing an already uploaded / synced activity (issue #96): validation and update payload.

import { isValidVisibility } from './social.js'
import { parseGear } from './gear.js'
import { isKnownRideType, rideTypeHasGear } from './rideType.js'
import { validateGearConfig, toGearPayload } from './gearSegments.js'

export const MAX_TITLE_LENGTH = 120
export const MAX_DESCRIPTION_LENGTH = 2000

/**
 * Validates the edit form and returns the `activities` update payload.
 *
 * Ride type (issue #279): `rideType` is optional. For a ride type without gear (road) the stored
 * gear is left untouched (hidden, not deleted). For track, either `gears` (+ `gearSegments`) is
 * given as a list, or the legacy single `chainring`/`cog` pair is used.
 * @returns {{ updates: object|null, error: string|null }}
 */
export function buildActivityUpdates({ title, trackId, visibility, chainring, cog, description, rideType, gears, gearSegments }) {
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
  if (rideType != null && !isKnownRideType(rideType)) return { updates: null, error: 'Invalid ride type' }
  const updates = {
    title: cleanTitle,
    track_id: trackId || null,
    visibility,
    description: cleanDescription || null,
  }
  if (rideType != null) updates.ride_type = rideType
  if (rideType != null && !rideTypeHasGear(rideType)) return { updates, error: null }

  if (Array.isArray(gears)) {
    const error = validateGearConfig(gears, gearSegments)
    if (error) return { updates: null, error }
    const list = toGearPayload(gears)
    updates.gears = list
    updates.gear_segments = list.length ? gearSegments || [] : []
    updates.chainring = list[0]?.chainring ?? null
    updates.cog = list[0]?.cog ?? null
    return { updates, error: null }
  }
  const gear = parseGear(chainring, cog)
  if (!gear.valid) return { updates: null, error: gear.error }
  updates.chainring = gear.chainring
  updates.cog = gear.cog
  return { updates, error: null }
}

export async function updateActivity(client, activityId, input) {
  if (!activityId) return { updates: null, error: new Error('Missing activity id') }
  const { updates, error: validationError } = buildActivityUpdates(input)
  if (validationError) return { updates: null, error: new Error(validationError) }
  const { error } = await client.from('activities').update(updates).eq('id', activityId)
  return { updates: error ? null : updates, error: error || null }
}
