// Lactate step test defaults (docs/lab/lactate-step-test.md): a fixed, read-only instruction and the
// default steps (% of FTP) that prefill the "New step test" form, which is the only step definition.
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

/** Step length for this test: whole minutes 1-20. */
export function normalizeStepMinutes(raw) {
  const minutes = Number(raw)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 20) return { error: 'Step length must be 1 to 20 minutes' }
  return { minutes }
}

/** Entry rows for the form: target watts per step when FTP is known. */
export function planToRows(plan, ftp) {
  return plan.steps.map((s) => ({ power: ftp > 0 ? String(Math.round((ftp * s.pct) / 100)) : '', hr: '', lactate: '' }))
}
