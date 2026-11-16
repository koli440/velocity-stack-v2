// Reads only the needed streams of an athlete's recent rides (RLS: the athlete or their active coach).
export async function fetchRideStreams(client, athleteId, { days = 120, limit = 30, hr = false } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const cols = `id, title, activity_date, watts:time_series->watts${hr ? ', hr:time_series->heartrate' : ''}`
  const { data, error } = await client
    .from('activities')
    .select(cols)
    .eq('user_id', athleteId)
    .gte('activity_date', since)
    .order('activity_date', { ascending: false })
    .limit(limit)
  return { rides: error ? [] : data || [], error }
}
