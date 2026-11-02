// "Sync now" also sends the rider's upcoming planned workouts to the platform that was just synced.
// Reuses the scheduled push (same idempotency: unchanged workouts are skipped, changed ones updated, deletions applied,
// per-provider horizon and per-run call cap), but ignores the opt-in auto-push switch because the rider asked for it.
import { PushError } from './intervalsEvents.js'
import { requireConnection as requireIntervalsConnection, pushRider as pushIntervalsRider } from './plannedPush.js'
import { requireWahooConnection, defaultMakeClient as wahooClient, pushWahooRider } from './wahooPush.js'
import { requireGarminConnection, defaultMakeClient as garminClient, pushGarminRider } from './garminPush.js'

export const PUSH_PROVIDERS = ['intervals', 'wahoo', 'garmin']
const PUSH_TIME_BUDGET_MS = 20000

const PROVIDERS = {
  intervals: {
    run: async ({ service, userId, now, deadline }) => {
      const conn = await requireIntervalsConnection(service, userId)
      return pushIntervalsRider({ service, riderId: userId, conn, now, deadline, makeClient: undefined, loadConnection: undefined, autoPush: true })
    },
  },
  wahoo: {
    run: async ({ service, userId, now, deadline }) => {
      const conn = await requireWahooConnection(service, userId)
      const client = await wahooClient(service, conn)
      return pushWahooRider({ service, riderId: userId, conn, client, now, deadline, autoPush: true })
    },
  },
  garmin: {
    run: async ({ service, userId, now, deadline }) => {
      const conn = await requireGarminConnection(service, userId)
      const client = await garminClient(service, conn)
      return pushGarminRider({ service, riderId: userId, conn, client, now, deadline, autoPush: true })
    },
  },
}

/**
 * `until` (ms epoch) caps the work so the whole request stays inside the function limit.
 * Pushes one rider's planned workouts to one provider. Never throws.
 * @returns {{ provider, pushed, removed, failed, message? } | null} null when the provider has no workout push.
 */
export async function pushPlannedForSync({ service, provider, userId, now = Date.now(), until = null, runners = PROVIDERS }) {
  const p = runners[provider]
  if (!p) return null
  const out = { provider, pushed: 0, removed: 0, failed: 0 }
  try {
    const r = await p.run({ service, userId, now, deadline: Math.min(Date.now() + PUSH_TIME_BUDGET_MS, until ?? Infinity) })
    out.pushed = r.pushed || 0
    out.removed = r.removed || 0
    out.failed = r.failed || 0
    if (r.stopped) out.message = r.stopped.message
    const patch = r.stopped
      ? { planned_push_error: r.stopped.message }
      : { planned_push_error: r.failed ? 'Some workouts could not be sent. Open them in the calendar for details.' : null, planned_push_at: new Date(now).toISOString() }
    await service.from('connections').update(patch).eq('user_id', userId).eq('provider', provider)
  } catch (e) {
    out.failed += 1
    out.message = e instanceof PushError ? e.message : 'Could not send workouts.'
  }
  return out
}
