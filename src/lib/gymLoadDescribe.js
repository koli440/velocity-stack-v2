// Plain-language text for the stored gym load breakdown (docs/gym-load.md). Pure, used by the activity page.

export const GYM_SOURCE_LABELS = Object.freeze({
  history: 'your earlier sessions (best estimated 1RM)',
  reps: 'reps performed (a rep ceiling, no earlier data)',
  velocity: 'bar speed loss within the exercise',
  dynamic: 'fixed value for jumps and throws (weight ignored)',
  mixed: 'a mix of the above',
})

/** "weight ignored for jumps"-style sentence for one model flag, or null for flags with no user meaning. */
export function describeGymFlag(flag) {
  const [kind, ...rest] = String(flag || '').split(':')
  const name = rest.join(':')
  switch (kind) {
    case 'assumed_unilateral': return `${name}: reps recorded for both legs/arms were assumed`
    case 'dynamic_with_weight': return `${name}: weight ignored for jumps and throws`
    case 'ceiling_intensity': return `${name}: intensity inferred from the reps, so it is an upper-bound guess`
    case 'high_rep_floor': return `${name}: very high reps, intensity held at a minimum`
    case 'velocity_loss_high': return `${name}: bar speed dropped a lot across sets (shown as a flag, no extra load)`
    case 'set_skipped_no_reps': return `${name}: a set without reps was not counted`
    case 'hr_skipped_no_reference': return 'Heart rate not used: not enough earlier gym sessions with heart rate to compare'
    case 'dynamic_sets_fixed_stress': return 'Jump and throw sets use a fixed stress per set'
    case 'no_working_sets': return 'No working sets were found'
    default: return null
  }
}

export function describeGymFlags(flags) {
  return [...new Set((flags || []).map(describeGymFlag).filter(Boolean))]
}

/** One exercise breakdown row -> display strings. */
export function describeBreakdownRow(row) {
  return {
    name: row.name,
    sets: `${row.workingSets} working set${row.workingSets === 1 ? '' : 's'}`,
    intensity: row.intensity == null ? '–' : `${Math.round(row.intensity * 100)}% of max`,
    source: GYM_SOURCE_LABELS[row.source] || '–',
    stress: row.stress == null ? '–' : String(Math.round(row.stress * 10) / 10),
  }
}

/** Short density / heart-rate sentences from the stored detail. */
export function describeGymInputs(detail) {
  const out = []
  const d = detail?.density
  if (d?.setsPerMin != null) out.push(`Pace: ${d.setsPerMin} working sets per minute (factor ×${d.multiplier})`)
  const hr = detail?.inputsUsed?.hrMultiplier
  if (hr && hr !== 1) out.push(`Heart rate adjusted the load slightly (×${hr})`)
  return out
}
