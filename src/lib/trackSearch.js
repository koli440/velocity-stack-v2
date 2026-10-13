// Pure search helpers for the shared velodrome picker (components/VelodromePicker.js).

const normalize = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

export function formatTrackMeta(track) {
  return [track.location, track.country_code, track.length_m ? `${track.length_m} m` : null, track.surface]
    .filter(Boolean)
    .join(' · ')
}

// Every whitespace-separated term must match somewhere in name/location/country/surface/length.
// Name-prefix matches rank first, then name matches, then the rest; ties favour the user's favorite (home) track, then sort alphabetically.
export function filterTracks(tracks, query, favoriteId = null) {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  const sorted = [...tracks].sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const favFirst = (a, b) => Number(b.id === favoriteId) - Number(a.id === favoriteId)
  if (terms.length === 0) return sorted.sort(favFirst)

  const scored = []
  for (const t of sorted) {
    const name = normalize(t.name)
    const haystack = [name, normalize(t.location), normalize(t.country_code), normalize(t.surface), normalize(t.length_m)].join(' ')
    if (!terms.every((term) => haystack.includes(term))) continue
    const rank = terms.every((term) => name.startsWith(term) || name.includes(' ' + term))
      ? 0
      : terms.every((term) => name.includes(term))
        ? 1
        : 2
    scored.push({ t, rank })
  }
  return scored.sort((a, b) => a.rank - b.rank || favFirst(a.t, b.t)).map((s) => s.t)
}
