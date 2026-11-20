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
