// Stable public slugs for velodromes: name + country, with a short id suffix on collisions.
const slugify = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export function baseTrackSlug(track) {
  const base = slugify([track.name, track.country_code].filter(Boolean).join(' '))
  return base || `track-${String(track.id || '').slice(0, 8)}`
}

/** Adds `slug` to each track; duplicates get the first 8 chars of the id so slugs stay unique and stable. */
export function withSlugs(tracks) {
  const counts = new Map()
  for (const t of tracks) {
    const b = baseTrackSlug(t)
    counts.set(b, (counts.get(b) || 0) + 1)
  }
  return tracks.map((t) => {
    const b = baseTrackSlug(t)
    const slug = counts.get(b) > 1 ? `${b}-${String(t.id || '').slice(0, 8).toLowerCase()}` : b
    return { ...t, slug }
  })
}

/** A track page is only indexable when the key facts are present. */
export function isIndexableTrack(t) {
  return !!(t && t.name && Number(t.length_m) > 0 && t.surface && t.country_code)
}
