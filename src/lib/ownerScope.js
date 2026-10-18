// Explicit owner scoping for own-account queries.
//
// RLS gives an active coach SELECT access to the rider's rows (is_coach_of), so a query that relies on
// RLS alone returns the coach's OWN rows PLUS every coached rider's rows. Queries on own-account pages
// must therefore always filter by owner; coach read access is only meant for athlete context
// (/coach/<riderId>/..., which passes the rider id explicitly). See docs/coaching.md.

// Ids are interpolated into a PostgREST filter string, so only a safe charset is accepted.
const SAFE_ID_RE = /^[\w-]+$/

/** Restricts a query builder to rows owned by `ownerId`. Refuses to run unscoped. */
export function scopeToOwner(query, ownerId, column = 'user_id') {
  if (!ownerId) throw new Error('scopeToOwner: an explicit owner id is required')
  return query.eq(column, ownerId)
}

/**
 * PostgREST `or` filter for analysis_templates a viewer may see on their OWN pages: system templates
 * (no owner), public ones and their own. Another rider's private templates (readable by a coach through
 * RLS) are excluded. Signed-out viewers only get system + public templates.
 */
export function visibleTemplatesFilter(userId) {
  const parts = ['user_id.is.null', 'visibility.eq.public']
  if (userId) {
    if (!SAFE_ID_RE.test(String(userId))) throw new Error('visibleTemplatesFilter: invalid user id')
    parts.push(`user_id.eq.${userId}`)
  }
  return parts.join(',')
}
