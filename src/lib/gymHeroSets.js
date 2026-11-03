// Batched gym_sets lookup for feed hero cards: one query for all visible gym sessions (no N+1).
// RLS limits rows to sessions the viewer may see; on error callers fall back to activity-level stats.
export async function fetchGymSetsByActivity(client, activityIds) {
  const ids = [...new Set((activityIds || []).filter(Boolean))]
  const byActivity = new Map()
  if (!ids.length) return { byActivity, error: null }
  const { data, error } = await client
    .from('gym_sets')
    .select('activity_id, exercise_id, set_type, reps, weight_kg')
    .in('activity_id', ids)
    .eq('set_type', 'active')
  if (error) return { byActivity: new Map(), error }
  for (const row of data || []) {
    if (!byActivity.has(row.activity_id)) byActivity.set(row.activity_id, [])
    byActivity.get(row.activity_id).push(row)
  }
  return { byActivity, error: null }
}
