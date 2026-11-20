// Pure helpers for showing the macro plan as guidance in the athlete's calendar (docs/macro-planner.md).
// Input is the JSON of the `macro_plan_calendar` RPC (only the plan the coach saved or applied, never suggestions).

const DAY_LABELS = { H: 'Hard', E: 'Easy', R: 'Rest' }

/** Phase label per week start: "Build 2/3", "Recovery", "Taper 1/2" (runs counted over consecutive weeks of the same kind). */
export function phaseLabels(weeks) {
  const sorted = [...(weeks || [])].sort((a, b) => (a.week_start < b.week_start ? -1 : 1))
  const out = new Map()
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j < sorted.length && sorted[j].kind === sorted[i].kind) j++
    for (let k = i; k < j; k++) {
      const kind = sorted[k].kind
      out.set(sorted[k].week_start, kind === 'recovery' ? 'Recovery' : `${kind === 'taper' ? 'Taper' : 'Build'} ${k - i + 1}/${j - i}`)
    }
    i = j
  }
  return out
}

/** Race markers by day: the A race plus B/C races, each { role, name }. */
export function raceMarkers(plan) {
  const map = new Map()
  const add = (day, role, name) => {
    if (!day) return
    map.set(day, [...(map.get(day) || []), { role, name: name || 'Race' }])
  }
  if (plan?.race_date) add(plan.race_date, 'A', plan.race_name)
  for (const r of plan?.races || []) if (!r.missing) add(r.race_date, r.priority, r.name)
  return map
}

/** Map of week_start -> guidance { target, focus, note, kind, phase, dayShape, rationale } for the plan's weeks. */
export function weekGuidance(plan) {
  const labels = phaseLabels(plan?.weeks)
  const map = new Map()
  for (const w of plan?.weeks || []) {
    map.set(w.week_start, {
      target: w.target_tl,
      focus: w.focus || '',
      note: w.note || '',
      kind: w.kind,
      phase: labels.get(w.week_start) || '',
      dayShape: typeof w.day_shape === 'string' && w.day_shape.length === 7 ? w.day_shape : '',
      rationale: w.rationale || '',
    })
  }
  return map
}

/** Hint for day index 0 (Monday) .. 6 from the week's day shape, or null when unset. */
export function dayHint(guidance, index) {
  const c = guidance?.dayShape?.[index]
  return DAY_LABELS[c] ? { code: c, label: DAY_LABELS[c] } : null
}

/**
 * Target vs done vs scheduled for a week. `done` = completed TL, `scheduled` = remaining planned workouts' ~TL.
 * toSchedule is what is still missing to hit the target (never negative).
 */
export function weekProgress(guidance, tl) {
  const target = Number(guidance?.target)
  if (!Number.isFinite(target)) return null
  const done = Math.round(tl?.completed || 0)
  const scheduled = Math.round(tl?.plannedRemaining || 0)
  return { target: Math.round(target), done, scheduled, toSchedule: Math.max(0, Math.round(target - done - scheduled)) }
}
