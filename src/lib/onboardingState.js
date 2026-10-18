// Per-user onboarding / news state (table user_onboarding_state, migration 20261211000000).
// Always the signed-in user's own row, also inside coach/athlete-context routes: the id comes from the session,
// never from the URL, and every query filters by it explicitly (docs/coaching.md).

import { scopeToOwner } from './ownerScope.js'
import { newestSeenMarker, unseenEntries } from './news.js'

const COLUMNS = 'welcome_seen_at, onboarding_dismissed_at, news_seen_through'

/** Reads the row, creating it (as a new account) through the RPC if it is missing. */
export async function fetchOnboardingState(supabase, userId) {
  const read = () => scopeToOwner(supabase.from('user_onboarding_state').select(COLUMNS), userId).maybeSingle()
  let { data, error } = await read()
  if (!data && !error) {
    const created = await supabase.rpc('ensure_my_onboarding_state')
    error = created.error
    if (!error) ({ data, error } = await read())
  }
  return { state: data || null, error: error || null }
}

export async function updateOnboardingState(supabase, userId, patch) {
  const allowed = {}
  for (const key of ['welcome_seen_at', 'onboarding_dismissed_at', 'news_seen_through']) {
    if (key in patch) allowed[key] = patch[key]
  }
  const { error } = await scopeToOwner(supabase.from('user_onboarding_state').update(allowed), userId)
  return { error: error || null }
}

/** The welcome tour opens once: not yet finished/skipped and the checklist not dismissed. */
export function shouldShowWelcome(state) {
  return !!state && !state.welcome_seen_at && !state.onboarding_dismissed_at
}

/** Unseen news for a loaded state (none until the state is known). */
export function unseenFor(state, entries) {
  return state ? unseenEntries(entries || [], state.news_seen_through) : []
}

/** Patch that marks everything in `entries` as seen. */
export function markSeenPatch(state, entries) {
  return { news_seen_through: newestSeenMarker(entries, state?.news_seen_through || '') }
}
