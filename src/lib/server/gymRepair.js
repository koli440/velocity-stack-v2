// src/lib/server/gymRepair.js
//
// Bounded repair for gym sessions imported before exercises/sets existed (#326 layer 2). Only file-backed
// sources can carry sets (Intervals.icu, Wahoo); Strava sessions are summary-only, so no Strava request is ever
// spent here. Each run re-reads at most `maxFetches` sessions, newest first, and stamps
// activities.gym_detail_checked_at so a session without sets is not retried. Rides are never touched.

import { prepareAnalysis } from '../gymAnalysis.js'
import { replaceGymDetail } from '../gymDetail.js'

export const GYM_REPAIR_PER_RUN = 3

export async function findGymDetailGaps(service, userId, source, limit = GYM_REPAIR_PER_RUN) {
  const { data, error } = await service
    .from('activities')
    .select('id, external_id')
    .eq('user_id', userId)
    .eq('activity_type', 'gym')
    .eq('external_source', source)
    .is('gym_detail_checked_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  return error ? [] : data || []
}

/** @returns {Promise<{ repaired: number, checked: number, failed: number, error: string|null }>} */
export async function repairGymDetail(service, { userId, provider, analyzeFit, maxFetches = GYM_REPAIR_PER_RUN }) {
  const out = { repaired: 0, checked: 0, failed: 0, error: null }
  if (!analyzeFit || (provider.source !== 'intervals' && provider.source !== 'wahoo')) return out
  const mark = (id) =>
    service.from('activities').update({ gym_detail_checked_at: new Date().toISOString() }).eq('id', id)

  for (const row of await findGymDetailGaps(service, userId, provider.source, maxFetches)) {
    try {
      const fetched = await provider.fetchActivity(row.external_id, { analyzeFit })
      const { gym } = prepareAnalysis(fetched, 'gym')
      if (gym) {
        const err = await replaceGymDetail(service, gym, { activityId: row.id, userId })
        if (err) throw new Error(err.message)
        out.repaired++
      }
      await mark(row.id)
      out.checked++
    } catch (err) {
      if (err?.status === 404) {
        await mark(row.id)
        out.checked++
        continue
      }
      if (err?.fatal || err?.status === 429) {
        out.error = err.message
        break
      }
      out.failed++
      out.error = err?.message || String(err)
    }
  }
  return out
}
