// Feature flag `macro_planner` (default off). The database enforces it inside every macro-planner RPC;
// this only mirrors it so the UI can hide entry points. Managed by admins (see docs/macro-planner.md).

export async function fetchMacroPlannerEnabled(client) {
  const { data, error } = await client.rpc('my_macro_planner_enabled')
  return error ? false : data === true
}

export function macroPlannerErrorMessage(error) {
  const msg = String(error?.message || '')
  if (/not enabled/i.test(msg)) return 'The macro planner is not available for your account yet.'
  if (/not authenticated/i.test(msg)) return 'Please sign in again.'
  return null
}

// ---- Plan RPCs (every one is flag- and relationship-checked in the database) ---------------------------------

/** The coach's plan for this athlete: { plan, error } (plan null when none exists yet). */
export async function fetchMacroPlan(client, riderId) {
  const { data, error } = await client.rpc('macro_plan_get', { p_rider: riderId })
  return error ? { plan: null, error } : { plan: data || null, error: null }
}

export async function saveMacroPlan(client, payload) {
  const { data, error } = await client.rpc('macro_plan_save', { p: payload })
  return error ? { id: null, error } : { id: data, error: null }
}

export async function publishMacroPlan(client, planId, published) {
  const { error } = await client.rpc('macro_plan_publish', { p_plan: planId, p_published: !!published })
  return { error: error || null }
}

export async function deleteMacroPlan(client, planId) {
  const { error } = await client.rpc('macro_plan_delete', { p_plan: planId })
  return { error: error || null }
}

/** The athlete's read-only view: the published plan of the active coach, or null (never errors loudly). */
export async function fetchMyMacroPlan(client) {
  const { data, error } = await client.rpc('my_macro_plan')
  return error ? null : data || null
}

/** Message to show for a failed plan RPC: known cases mapped, otherwise the (readable) database message. */
export function macroPlanSaveMessage(error) {
  const mapped = macroPlannerErrorMessage(error)
  if (mapped) return mapped
  const msg = String(error?.message || '').trim()
  if (/not coaching/i.test(msg)) return 'You are not coaching this athlete.'
  return msg && msg.length <= 160 && !/violates|constraint|syntax/i.test(msg) ? msg : 'Could not save the plan.'
}

// ---- Adapting the plan (disruptions, B/C races, availability, reviews, sharing, audit) ------------------------

const call = async (client, fn, args) => {
  const { data, error } = await client.rpc(fn, args)
  return error ? { data: null, error } : { data, error: null }
}

export const saveDisruption = (client, planId, d) => call(client, 'macro_plan_disruption_save', { p_plan: planId, p: d })
export const deleteDisruption = (client, planId, id) => call(client, 'macro_plan_disruption_delete', { p_plan: planId, p_id: id })
export const setMinorRaces = (client, planId, races) => call(client, 'macro_plan_races_set', { p_plan: planId, p: races })
export const setAvailability = (client, planId, rows) => call(client, 'macro_plan_availability_set', { p_plan: planId, p: rows })
export const setReview = (client, planId, week, reason, status) => call(client, 'macro_plan_review_set', { p_plan: planId, p_week: week, p_reason: reason, p_status: status })
export const setShareReasoning = (client, planId, share, rationale) => call(client, 'macro_plan_share_set', { p_plan: planId, p_share: !!share, p_rationale: rationale || '' })
/** Applies one coach-approved option (weeks + optional goal) and writes the audit row in one transaction. */
export const applyPlanOption = (client, planId, payload) => call(client, 'macro_plan_apply', { p_plan: planId, p: payload })
