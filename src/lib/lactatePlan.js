// Lactate step test: fixed instruction (read-only for everyone) and editable prepared steps
// (docs/lab/lactate-step-test.md). Steps are % of FTP.
export const LACTATE_INSTRUCTION = [
  'Do the test on a smart trainer or a flat road, rested, fuelled and with the same equipment you train with.',
  'Warm up 10-15 minutes easy. Ride each step at the target power, steady, for the full step length.',
  'In the last 30 seconds of every step, take a lactate sample (fingertip, wipe the first drop) and note your heart rate, then go straight into the next step.',
  'Stop when lactate is clearly above 4 mmol/L or you cannot hold the target power. Cool down 10 minutes.',
  'Enter power, heart rate and lactate of each step below.',
].join('\n')

export const DEFAULT_LACTATE_PLAN = Object.freeze({
  step_minutes: 4,
  steps: Object.freeze([50, 60, 70, 80, 90, 100, 110].map((pct) => Object.freeze({ pct }))),
})

/** Cleans plan input from the editor. Returns { plan } or { error }. */
export function normalizePlan(raw) {
  const minutes = Number(raw?.step_minutes)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 20) return { error: 'Step length must be 1 to 20 minutes' }
  const steps = []
  for (const s of raw?.steps || []) {
    if (s?.pct === '' || s?.pct == null) continue
    const pct = Number(s.pct)
    if (!(pct >= 20 && pct <= 200)) return { error: 'Each step needs a percentage of FTP between 20 and 200' }
    steps.push({ pct: Math.round(pct) })
  }
  if (steps.length < 3) return { error: 'Enter at least 3 steps' }
  if (steps.length > 20) return { error: 'At most 20 steps' }
  return { plan: { step_minutes: minutes, steps } }
}

/** Plan from the lab_lactate_plan_get RPC, falling back to the defaults. */
export function resolvePlan(data) {
  const custom = !!data?.custom
  return {
    custom,
    fromCoach: !!data?.from_coach,
    editable: data ? !!data.editable : true,
    plan: custom ? { step_minutes: data.step_minutes, steps: data.steps } : DEFAULT_LACTATE_PLAN,
  }
}

/** Entry rows for the form: target watts per step when FTP is known. */
export function planToRows(plan, ftp) {
  return plan.steps.map((s) => ({ power: ftp > 0 ? String(Math.round((ftp * s.pct) / 100)) : '', hr: '', lactate: '' }))
}
