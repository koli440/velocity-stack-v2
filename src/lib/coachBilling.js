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
  if (/accepted you|cannot take payments|under 18|not available|own package|choose your country/i.test(m)) return m
  return 'Something went wrong. Please try again.'
}

// Countries offered for the connected account (Stripe-supported EU/EEA + UK/CH). Sent as identity.country, which Stripe
// requires before the merchant configuration can be set.
export const CONNECT_COUNTRIES = {
  AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', HR: 'Croatia', CY: 'Cyprus', CZ: 'Czechia', DK: 'Denmark', EE: 'Estonia',
  FI: 'Finland', FR: 'France', DE: 'Germany', GR: 'Greece', HU: 'Hungary', IE: 'Ireland', IT: 'Italy', LV: 'Latvia',
  LI: 'Liechtenstein', LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta', NL: 'Netherlands', NO: 'Norway', PL: 'Poland',
  PT: 'Portugal', RO: 'Romania', SK: 'Slovakia', SI: 'Slovenia', ES: 'Spain', SE: 'Sweden', CH: 'Switzerland', GB: 'United Kingdom',
}
export const normalizeConnectCountry = (c) => {
  const u = String(c || '').toUpperCase()
  return Object.prototype.hasOwnProperty.call(CONNECT_COUNTRIES, u) ? u : null
}
// Best-effort preselection from the browser locale (region part); the coach can change it.
export const guessConnectCountry = (locale) => normalizeConnectCountry(String(locale || '').split(/[-_]/)[1])

export const startConnectOnboarding = (country) => post('/api/billing/connect/onboard', { country })
export const startCheckout = (packageId) => post('/api/billing/checkout', { packageId })
export const openBillingPortal = (coachId) => post('/api/billing/portal', coachId ? { coachId } : {})

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

/** Open "pay for your plan" prompts of the signed-in athlete (accepted application with a paid package). */
export async function fetchPaymentDue(client) {
  const { data, error } = await client.rpc('my_payment_due')
  return { due: error ? [] : data || [], error }
}

/** Subscriptions I pay (as_rider) and receive (as_coach); owner-scoped, no coach-module flag needed. */
export async function fetchPaymentOverview(client) {
  const { data, error } = await client.rpc('my_payment_overview')
  return { overview: error || !data ? { as_rider: [], as_coach: [] } : data, error }
}

/** role 'rider' = payments I made, 'coach' = payments I received. */
export async function fetchPayments(client, role) {
  const { data, error } = await client.rpc('my_payments', { p_role: role })
  return { rows: error || !data ? [] : data.rows || [], totals: error || !data ? [] : data.month_totals || [], error }
}
