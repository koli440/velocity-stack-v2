// Central lookups (disciplines, countries, surfaces). The DB tables (see
// supabase/migrations/20261111000000_central_lookups.sql) are the single source of truth.

export function mapDisciplineRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    distanceM: Number(row.distance_m),
    flyingStart: !!row.flying_start,
    gender: row.gender,
    ageGroup: row.age_group,
    minTrackLengthM: row.min_track_length_m == null ? null : Number(row.min_track_length_m),
    maxTrackLengthM: row.max_track_length_m == null ? null : Number(row.max_track_length_m),
  }
}

/** Whether a discipline applies to a track length (null bounds = unrestricted). */
export function disciplineFitsTrack(discipline, trackLengthM) {
  if (!discipline || !trackLengthM) return true
  const { minTrackLengthM: min, maxTrackLengthM: max } = discipline
  return (min == null || trackLengthM >= min) && (max == null || trackLengthM <= max)
}

export function findDisciplineDistance(disciplines, name) {
  const match = (disciplines || []).find((d) => d.name === name)
  return match ? match.distanceM : null
}

export async function fetchDisciplines(client) {
  try {
    const { data, error } = await client
      .from('disciplines')
      .select('*')
      .order('sort_order', { ascending: true })
    if (!error && data && data.length > 0) return data.map(mapDisciplineRow)
  } catch {
    // fall through to an empty list
  }
  return []
}

export async function fetchCountries(client) {
  const { data, error } = await client.from('countries').select('code, name').order('name')
  return error || !data ? [] : data
}

export async function fetchSurfaces(client) {
  const { data, error } = await client
    .from('surfaces')
    .select('name')
    .order('sort_order', { ascending: true })
  return error || !data ? [] : data.map((s) => s.name)
}

/** The single velodrome data source: every picker/list loads tracks through this. */
export function fetchTracks(supabase) {
  return supabase.from('tracks').select('*').order('name', { ascending: true })
}
