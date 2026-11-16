// Coach onboarding questionnaire (apply flow /c/<slug>/apply, coach applications, rider "my answers").
// Validation mirrors supabase/migrations/20270153000000_coach_onboarding.sql; the database is authoritative.
export const CONSENT_VERSION = 1
export const CONSENT_TEXT = [
  'I am applying to this coach and share the answers below with them so they can prepare my coaching.',
  'My health answers (if I give any) are optional, are only shown to this coach, and are never used for anything else.',
  'If we start working together, VelocityStack may create my FTP, weight, thresholds, races and unavailable days from these answers, only where I have none yet.',
  'I can edit, withdraw or delete my answers at any time in Settings. Withdrawing cuts the coach\'s access and cancels a pending request.',
].join('\n')

export const PARQ_QUESTIONS = Object.freeze([
  'Has a doctor ever said you have a heart condition and should only do physical activity recommended by a doctor?',
  'Do you feel pain in your chest when you do physical activity?',
  'In the past month, have you had chest pain when you were not doing physical activity?',
  'Do you lose your balance because of dizziness, or do you ever lose consciousness?',
  'Do you have a bone or joint problem that could be made worse by a change in your physical activity?',
  'Is a doctor currently prescribing medication for your blood pressure or a heart condition?',
  'Do you know of any other reason why you should not do physical activity?',
])
export const WEEKDAYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
export const AVAILABILITY = Object.freeze({ none: 'Not available', short: 'Short sessions', long: 'Long sessions' })
export const SEX_OPTIONS = Object.freeze({ female: 'Female', male: 'Male', other: 'Other', na: 'Prefer not to say' })
export const STRUCTURE_OPTIONS = Object.freeze({ none: 'No structure', self: 'Self-planned', plan: 'Following a plan', coach: 'With a coach' })
export const PRIORITIES = Object.freeze(['A', 'B', 'C'])
export const MAX_EVENTS = 5
export const MAX_BLACKOUT = 10
export const MAX_COACH_QUESTIONS = 5
export const COACH_QUESTION_MAX = 200

/** SHA-256 hex of the consent text, stored with the consent as proof of what was shown. */
export async function consentHash(text = CONSENT_TEXT) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

export const ageOn = (dob, today = new Date()) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return null
  const d = new Date(`${dob}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  let age = today.getUTCFullYear() - d.getUTCFullYear()
  const m = today.getUTCMonth() - d.getUTCMonth()
  if (m < 0 || (m === 0 && today.getUTCDate() < d.getUTCDate())) age -= 1
  return age
}
export const isMinor = (dob, today) => {
  const a = ageOn(dob, today)
  return a !== null && a < 18
}

const blank = (v) => v === '' || v == null
const num = (v) => (blank(v) ? undefined : Number(v))
const txt = (v) => (blank(v) ? undefined : String(v).trim() || undefined)
const prune = (o) => {
  const out = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || (Array.isArray(v) && v.length === 0) || (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)) continue
    out[k] = v
  }
  return out
}

/** Form state -> the JSON the submit_onboarding RPC expects. Empty fields are dropped. */
export function buildAnswers(f) {
  const events = (f.events || []).filter((e) => txt(e.name)).map((e) => prune({ name: txt(e.name), date: txt(e.date), priority: txt(e.priority) }))
  const blackout = (f.blackout || []).filter((b) => txt(b.date)).map((b) => prune({ date: txt(b.date), note: txt(b.note) }))
  const weekdays = {}
  for (const d of WEEKDAYS) if (f.weekdays?.[d]) weekdays[d] = f.weekdays[d]
  const out = {
    about: prune({ dob: txt(f.dob), sex: txt(f.sex), height_cm: num(f.height_cm), weight_kg: num(f.weight_kg), country: txt(f.country), language: txt(f.language) }),
    goals: prune({ main_goal: txt(f.main_goal), goal_text: txt(f.goal_text), why_now: txt(f.why_now), timeframe: txt(f.timeframe), events }),
    history: prune({
      years_riding: num(f.years_riding), weekly_hours: num(f.weekly_hours), weekly_km: num(f.weekly_km), structure: txt(f.structure),
      ftp_w: num(f.ftp_w), ftp_date: txt(f.ftp_date), ftp_method: txt(f.ftp_method), max_hr: num(f.max_hr), lt1_w: num(f.lt1_w),
      lt2_w: num(f.lt2_w), indoor_pct: num(f.indoor_pct), other_sports: txt(f.other_sports),
    }),
    availability: prune({ hours_per_week: num(f.hours_per_week), contact_style: txt(f.contact_style), weekdays, blackout }),
    equipment: prune({
      power_meter: txt(f.power_meter), hr: txt(f.hr), smart_trainer: txt(f.smart_trainer), head_unit: txt(f.head_unit), bike_type: txt(f.bike_type),
      platforms: String(f.platforms || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10),
    }),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => Object.keys(v).length > 0))
}

/** Inverse of buildAnswers, for editing a stored submission. */
export function answersToForm(a = {}) {
  const f = {
    ...(a.about || {}), ...(a.goals || {}), ...(a.history || {}), ...(a.availability || {}), ...(a.equipment || {}),
    events: (a.goals?.events || []).map((e) => ({ name: e.name || '', date: e.date || '', priority: e.priority || 'B' })),
    blackout: (a.availability?.blackout || []).map((b) => ({ date: b.date || '', note: b.note || '' })),
    weekdays: { ...(a.availability?.weekdays || {}) },
    platforms: (a.equipment?.platforms || []).join(', '),
  }
  return f
}

/** First problem in the form (null when fine). Light mirror of the SQL checks. */
export function validateForm(f, { health, healthDeclined, consent } = {}) {
  if (!consent) return 'Please read and accept the consent statement.'
  if (!f.dob || ageOn(f.dob) === null) return 'Date of birth is required (YYYY-MM-DD).'
  const age = ageOn(f.dob)
  if (age < 10 || age > 105) return 'Please check your date of birth.'
  const range = (v, lo, hi, name) => (!blank(v) && !(Number(v) >= lo && Number(v) <= hi) ? `${name} must be between ${lo} and ${hi}.` : null)
  const checks = [
    range(f.height_cm, 100, 250, 'Height'), range(f.weight_kg, 30, 200, 'Weight'), range(f.ftp_w, 50, 700, 'FTP'),
    range(f.max_hr, 100, 250, 'Max heart rate'), range(f.weekly_hours, 0, 60, 'Weekly hours'), range(f.hours_per_week, 0, 60, 'Available hours'),
    range(f.indoor_pct, 0, 100, 'Indoor share'),
  ]
  const bad = checks.find(Boolean)
  if (bad) return bad
  if ((f.events || []).length > MAX_EVENTS) return `At most ${MAX_EVENTS} events.`
  if ((f.blackout || []).length > MAX_BLACKOUT) return `At most ${MAX_BLACKOUT} unavailable days.`
  if (health && (age < 18 || healthDeclined)) return 'Health answers are not collected for this application.'
  return null
}

export const healthFlag = (health) => !!health?.parq?.some(Boolean)

export function onboardingErrorMessage(error) {
  const msg = String(error?.message || '')
  if (/not enabled/i.test(msg)) return 'The coach module is not available for this coach yet.'
  if (/Date of birth is required/i.test(msg)) return 'Date of birth is required.'
  if (/Health answers are not accepted/i.test(msg)) return 'Health answers are not accepted for this application.'
  if (/Answers are too long/i.test(msg)) return 'Your answers are too long. Please shorten them.'
  if (/Invalid answer/i.test(msg)) return `Please check your answers (${msg.replace(/^.*Invalid answer:?\s*/i, '') || 'invalid value'}).`
  if (/cooldown|recently|Too many|pending/i.test(msg)) return msg
  if (/block/i.test(msg)) return 'You cannot apply to this coach.'
  if (/active coach|already/i.test(msg)) return msg
  return 'Something went wrong. Please try again.'
}

export const DRAFT_KEY = (slug) => `coach-apply-draft:${slug}`

// ---- Data access ---------------------------------------------------------------------------
export async function fetchApplyInfo(client, slug) {
  const { data, error } = await client.rpc('coach_apply_info', { p_slug: slug })
  return { info: error ? null : data || null, error }
}
export async function submitOnboarding(client, slug, { answers, health, healthDeclined, coachAnswers }) {
  const { data, error } = await client.rpc('submit_onboarding', {
    p_slug: slug, p_answers: answers, p_health: health || null, p_health_declined: !!healthDeclined,
    p_coach_answers: coachAnswers || {}, p_consent_version: CONSENT_VERSION, p_consent_hash: await consentHash(),
  })
  return { id: error ? null : data, error }
}
export async function fetchMyOnboarding(client) {
  const { data, error } = await client.rpc('my_onboarding')
  return { rows: error ? [] : data || [], error }
}
export const editOnboarding = async (client, id, { answers, health, healthDeclined, coachAnswers }) => {
  const { error } = await client.rpc('edit_onboarding_answers', {
    p_id: id, p_answers: answers, p_health: health || null, p_health_declined: !!healthDeclined, p_coach_answers: coachAnswers || {},
  })
  return { error }
}
export const withdrawOnboarding = async (client, id) => ({ error: (await client.rpc('withdraw_onboarding_consent', { p_id: id })).error })
export const deleteOnboarding = async (client, id) => ({ error: (await client.rpc('delete_onboarding_answers', { p_id: id })).error })
export async function fetchCoachApplications(client) {
  const { data, error } = await client.rpc('coach_applications')
  return { rows: error ? [] : data || [], error }
}
export async function fetchCoachApplication(client, id) {
  const { data, error } = await client.rpc('coach_application_get', { p_id: id })
  return { application: error ? null : data || null, error }
}
export async function fetchMyQuestions(client) {
  const { data, error } = await client.rpc('my_coach_questions')
  return { questions: error ? [] : data || [], error }
}
export async function saveQuestions(client, questions) {
  const { error } = await client.rpc('save_coach_questions', { p: questions.map((q) => q.trim()).filter(Boolean) })
  return { error }
}
