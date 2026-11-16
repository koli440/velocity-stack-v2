// Client helpers for coach payments (Stripe Connect, test mode). All money logic is server-side.
// supabase is imported lazily so the pure helpers stay unit-testable.
const authHeader = async () => (await import('./supabase')).getAuthHeader()

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify(body || {}) })
  const json = await res.json().catch(() => ({}))
  return res.ok && json.url ? { url: json.url } : { error: billingErrorMessage(json.error, res.status) }
}

export function billingErrorMessage(message, status) {
  if (status === 503) return 'Payments are not available yet.'
  if (status === 401) return 'Sign in to continue.'
  const m = String(message || '')
  if (/accepted you|cannot take payments|under 18|not available|own package/i.test(m)) return m
  return 'Something went wrong. Please try again.'
}

export const startConnectOnboarding = (country) => post('/api/billing/connect/onboard', { country })
export const startCheckout = (packageId) => post('/api/billing/checkout', { packageId })
export const openBillingPortal = () => post('/api/billing/portal')

export async function fetchBillingStatus() {
  const res = await fetch('/api/billing/connect/status', { headers: await authHeader() })
  return res.ok ? res.json() : null
}

export function connectStateLabel(s) {
  if (!s || !s.configured) return 'Payments are not available yet.'
  if (!s.connected) return 'Not set up'
  if (s.charges_enabled && s.payouts_enabled) return 'Ready to take payments'
  if (s.details_submitted) return 'Stripe is reviewing your details'
  return 'Setup not finished'
}

export const subscriptionStatusLabel = (st) =>
  ({ active: 'Active', trialing: 'Trial', past_due: 'Payment overdue', unpaid: 'Unpaid', canceled: 'Cancelled', paused: 'Paused', incomplete: 'Incomplete', incomplete_expired: 'Expired' })[st] || 'Unknown'
