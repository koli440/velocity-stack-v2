// "Race" activity tag (issue #294, migration 20261230000000_activity_race_tag.sql).
//
// The tag is set manually (rider or active coach, stamped and audited) AND automatically when the activity is
// linked to a calendar race. `race_tag_auto` is TRUE only while the tag exists solely because of that link:
// unlinking (or deleting the race) removes an auto tag and never a manual one; any manual change (set or clear)
// makes the tag manual.

/** Sets or clears the race tag through the single audited path (owner or active coach). */
export async function setActivityRace(client, activityId, isRace) {
  if (!activityId) return { isRace: null, error: new Error('Missing activity id') }
  const { data, error } = await client.rpc('set_activity_race', { p_activity: activityId, p_is_race: Boolean(isRace) })
  return { isRace: error ? null : Boolean(data), error: error || null }
}

/** Short origin note under the tag toggle ('' when the activity is not a race). */
export function raceTagOrigin(activity) {
  if (!activity?.is_race) return ''
  if (activity.race_tag_auto) return 'Tagged automatically because it is linked to a calendar race. Unlinking removes the tag.'
  if (activity.race_set_by_coach) return 'Tagged by your coach. It stays when a calendar race is unlinked.'
  return 'Tagged manually. It stays when a calendar race is unlinked.'
}

/** Sets the tag, then reloads the tag columns (flags and stamp) for the UI. */
export async function saveActivityRace(client, activityId, isRace) {
  const { isRace: saved, error } = await setActivityRace(client, activityId, isRace)
  if (error) return { fresh: null, error }
  const { data } = await client
    .from('shared_activities')
    .select('is_race, race_tag_auto, race_set_by, race_set_at, race_set_by_coach')
    .eq('id', activityId)
    .maybeSingle()
  return { fresh: data || { is_race: saved, race_tag_auto: false }, error: null }
}
