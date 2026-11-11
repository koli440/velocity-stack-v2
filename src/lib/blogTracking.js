// Anonymous blog events (post views, feed card impressions/clicks, 75% read depth), see docs/analytics.md.
// Sent to the track_blog_event() RPC: only the event name and the post slug; no user id, IP, cookie or storage value.
// Fire-and-forget: never throws and never blocks rendering. Callers dedupe per page load / feed mount.
import { SLUG_RE } from './blog.js'

export const BLOG_EVENTS = Object.freeze(['blog_view', 'blog_card_impression', 'blog_card_click', 'blog_read_75'])
export const MAX_SLUG_LENGTH = 80
export const READ_DEPTH = 0.75

/** RPC payload, or null when the event or slug would be rejected by the server anyway. */
export function blogEventParams(event, slug) {
  if (!BLOG_EVENTS.includes(event)) return null
  if (typeof slug !== 'string' || slug.length > MAX_SLUG_LENGTH || !SLUG_RE.test(slug)) return null
  return { p_event: event, p_slug: slug }
}

/** Returns true when a request was started. */
export function trackBlogEvent(client, event, slug) {
  const params = blogEventParams(event, slug)
  if (!client || !params) return false
  try {
    Promise.resolve(client.rpc('track_blog_event', params)).catch(() => {})
  } catch {
    // tracking must never break the page
  }
  return true
}

/** True once the bottom of the viewport has passed 75% of the article (top/height from getBoundingClientRect, viewport height). */
export function readDepthReached(rect, viewportHeight, depth = READ_DEPTH) {
  if (!rect || !(rect.height > 0) || !(viewportHeight > 0)) return false
  return viewportHeight - rect.top >= rect.height * depth
}
