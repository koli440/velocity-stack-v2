// src/lib/server/wahooPlans.js
// Wahoo Cloud calls for pushing planned workouts: plans (library records with the steps) and workouts (the
// scheduled day that references a plan). Needs the plans_write / workouts_write scopes; riders who connected
// before these scopes existed get an actionable "reconnect" error.

import { PushError } from './intervalsEvents.js'
import { WAHOO_API } from '../wahoo.js'
import { planFileDataUri } from '../wahooPlan.js'

const RECONNECT = 'Reconnect Wahoo in Settings → Connections to allow sending workouts.'

async function snippet(res) {
  try {
    return (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 200)
  } catch {
    return ''
  }
}

/** @param {{ accessToken: string, fetchImpl?: typeof fetch }} args */
export function createWahooPlanClient({ accessToken, fetchImpl = fetch }) {
  async function request(method, path, fields) {
    let res
    try {
      res = await fetchImpl(`${WAHOO_API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        body: fields ? new URLSearchParams(fields) : undefined,
        cache: 'no-store',
      })
    } catch {
      throw new PushError('unreachable', 'Could not reach Wahoo. Try again in a moment.', { status: 502 })
    }
    if (res.ok) {
      const text = await res.text()
      return text ? JSON.parse(text) : null
    }
    if (res.status === 401) throw new PushError('auth', 'Wahoo rejected the connection. Reconnect Wahoo in Settings → Connections.', { status: 409, fatal: true })
    if (res.status === 403) throw new PushError('scope', RECONNECT, { status: 409, fatal: true })
    if (res.status === 404) throw new PushError('not_found', 'Not found at Wahoo.', { status: 404 })
    if (res.status === 429) throw new PushError('rate_limited', 'Wahoo rate limit reached. Try again in a few minutes.', { status: 429, retryAfterSec: 300 })
    throw new PushError('wahoo_error', `Wahoo returned ${res.status}${(await snippet(res)) ? `: ${await snippet(res)}` : ''}`, { status: 502 })
  }

  const planFields = (plan, externalId, updatedAt) => ({
    'plan[file]': planFileDataUri(plan),
    'plan[filename]': 'plan.json',
    ...(externalId ? { 'plan[external_id]': externalId } : {}),
    'plan[provider_updated_at]': updatedAt,
  })

  return {
    /** @returns {Promise<string>} plan id */
    async createPlan(plan, externalId, updatedAt) {
      const r = await request('POST', '/v1/plans', planFields(plan, externalId, updatedAt))
      return String(r.id)
    },
    async updatePlan(id, plan, updatedAt) {
      const r = await request('PUT', `/v1/plans/${encodeURIComponent(id)}`, planFields(plan, null, updatedAt))
      return String(r.id ?? id)
    },
    async deletePlan(id) {
      await request('DELETE', `/v1/plans/${encodeURIComponent(id)}`)
    },
    /** Plan of ours with this external id (a push whose response was lost), or null. */
    async findPlanByExternalId(externalId) {
      const list = await request('GET', '/v1/plans')
      const rows = Array.isArray(list) ? list : list?.plans || []
      const hit = rows.find((p) => p.external_id === externalId && !p.deleted)
      return hit ? String(hit.id) : null
    },
    async createWorkout(fields) {
      const r = await request('POST', '/v1/workouts', fields)
      return String(r.id)
    },
    async updateWorkout(id, fields) {
      const r = await request('PUT', `/v1/workouts/${encodeURIComponent(id)}`, fields)
      return String(r.id ?? id)
    },
    async deleteWorkout(id) {
      await request('DELETE', `/v1/workouts/${encodeURIComponent(id)}`)
    },
  }
}
