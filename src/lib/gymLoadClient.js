// Browser helpers that ask the server to (re)score gym sessions (the model runs server-side, see gymLoadStore.js).
// Always best-effort: a failure leaves the session unscored/stale and the self-service backfill picks it up later.

const authHeader = async () => (await import('./supabase')).getAuthHeader()

/** Score one activity (after the editor saved it or a browser import). Resolves true when a load was stored. */
export async function requestGymLoad(activityId) {
  try {
    const res = await fetch(`/api/activities/${activityId}/gym-load`, { method: 'POST', headers: await authHeader() })
    return res.ok
  } catch {
    return false
  }
}

/** Score the signed-in rider's unscored/stale gym sessions. Resolves the server counts or null. */
export async function requestGymLoadBackfill() {
  try {
    const res = await fetch('/api/gym-load', { method: 'POST', headers: await authHeader() })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}
