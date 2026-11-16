// Feature flag `coach_module` (default off). The database enforces it inside every coach-module RPC;
// this only mirrors it so the UI can hide entry points. Managed by admins (see docs/coaching.md).

export async function fetchCoachModuleEnabled(client) {
  const { data, error } = await client.rpc('my_coach_module_enabled')
  return error ? false : data === true
}

export function coachModuleErrorMessage(error) {
  const msg = String(error?.message || '')
  if (/not enabled/i.test(msg)) return 'The coach module is not available for your account yet.'
  if (/not authenticated/i.test(msg)) return 'Please sign in again.'
  return null
}
