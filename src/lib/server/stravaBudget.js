// src/lib/server/stravaBudget.js
// Shared Strava budget tracker backed by public.strava_rate_budget (service role). One tracker per run:
// it loads the app-wide usage, counts our own requests locally, folds in the usage headers of every
// response, and persists the result with flush().

import {
  normalizeBudget,
  parseBudgetHeaders,
  applyObservation,
  spend,
  canSpend,
  remainingRequests,
  budgetToRpcArgs,
  window15Start,
  dayStart,
} from '../stravaBudget.js'

export async function loadStravaBudget(service, { now = () => new Date() } = {}) {
  let budget = normalizeBudget(null, now())
  try {
    const { data } = await service.from('strava_rate_budget').select('*').eq('id', 1).maybeSingle()
    budget = normalizeBudget(data, now())
  } catch (err) {
    // Without the table (migration pending) fall back to in-memory counting with the default limits.
    console.warn('Loading strava_rate_budget failed:', err?.message)
  }
  let w15 = window15Start(now()).getTime()
  let day = dayStart(now())
  let dirty = false

  // A window that rolled over during a long run starts from zero.
  const roll = () => {
    const t = now()
    if (window15Start(t).getTime() !== w15) {
      w15 = window15Start(t).getTime()
      budget = { ...budget, read15m: 0, overall15m: 0 }
    }
    if (dayStart(t) !== day) {
      day = dayStart(t)
      budget = { ...budget, readDay: 0, overallDay: 0 }
    }
  }

  return {
    get state() {
      roll()
      return budget
    },
    remaining(purpose = 'live') {
      roll()
      return remainingRequests(budget, purpose)
    },
    canSpend(purpose = 'live', n = 1) {
      roll()
      return canSpend(budget, purpose, n)
    },
    /** Counts one request when the purpose still has budget; false when it does not. */
    reserve(purpose = 'live') {
      roll()
      if (!canSpend(budget, purpose, 1)) return false
      budget = spend(budget, 1)
      dirty = true
      return true
    },
    observe(headers) {
      const observed = parseBudgetHeaders(headers)
      if (!observed) return
      roll()
      budget = applyObservation(budget, observed)
      dirty = true
    },
    async flush() {
      if (!dirty) return
      dirty = false
      roll()
      try {
        const { error } = await service.rpc('record_strava_rate_usage', budgetToRpcArgs(budget))
        if (error) console.warn('record_strava_rate_usage failed:', error.message)
      } catch (err) {
        console.warn('record_strava_rate_usage failed:', err?.message)
      }
    },
  }
}
