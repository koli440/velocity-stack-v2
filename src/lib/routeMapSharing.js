// Who may see the GPS route map of the rider's activities (profiles.route_map_sharing, migration 20270142000000).
// Enforced server-side by shared_route_gps()/can_view_route_map(); this module only drives the settings UI and the map.

export const ROUTE_MAP_SHARING = Object.freeze({
  off: { label: 'Only me', hint: 'Nobody else sees the route map or the route thumbnail.' },
  coach: { label: 'My coach', hint: 'Only your active coach sees the route.' },
  followers: { label: 'Coach and followers', hint: 'Followers who can see the activity (and your coach) see the route.' },
  public: { label: 'Everyone who can see the activity', hint: 'Also riders who are not following you, on public activities.' },
})
export const DEFAULT_ROUTE_MAP_SHARING = 'followers'

export const normalizeRouteMapSharing = (v) => (Object.hasOwn(ROUTE_MAP_SHARING, v) ? v : DEFAULT_ROUTE_MAP_SHARING)

/**
 * Splits a GPS trace into continuous segments. Missing samples (null, e.g. hidden by a privacy zone) and (0,0) end a
 * segment, so no line is drawn across a hidden area.
 */
export function routeSegments(latitude, longitude) {
  const segments = []
  let current = []
  const len = Math.min(latitude?.length || 0, longitude?.length || 0)
  for (let i = 0; i < len; i++) {
    const lat = latitude[i]
    const lng = longitude[i]
    if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      current.push([lat, lng])
    } else if (current.length) {
      segments.push(current)
      current = []
    }
  }
  if (current.length) segments.push(current)
  return segments.filter((s) => s.length > 1)
}
