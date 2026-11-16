// Field protocol forms (docs/lab/field-forms.md): body composition, mobility checklist, sprint test.
// Ranges mirror the lab_field_save RPC, which is the authoritative validation.
export const FIELD_KINDS = Object.freeze([
  { key: 'body', label: 'Body composition' },
  { key: 'mobility', label: 'Mobility checklist' },
  { key: 'sprint', label: 'Sprint test' },
])

export const BODY_FIELDS = Object.freeze([
  { key: 'weight_kg', label: 'Weight (kg)', min: 20, max: 300 },
  { key: 'body_fat_pct', label: 'Body fat (%)', min: 2, max: 60 },
  { key: 'waist_cm', label: 'Waist (cm)', min: 30, max: 250 },
  { key: 'hip_cm', label: 'Hip (cm)', min: 30, max: 250 },
  { key: 'chest_cm', label: 'Chest (cm)', min: 30, max: 250 },
  { key: 'thigh_cm', label: 'Thigh (cm)', min: 10, max: 120 },
])

export const SPRINT_FIELDS = Object.freeze([
  { key: 'distance_m', label: 'Distance (m)', min: 10, max: 1000, required: true },
  { key: 'time_s', label: 'Time (s)', min: 0.5, max: 120, required: true },
  { key: 'peak_power_w', label: 'Peak power (W)', min: 1, max: 3500 },
])

export const MOBILITY_ITEMS = Object.freeze([
  { key: 'ankle_dorsiflexion', label: 'Ankle dorsiflexion' },
  { key: 'hip_flexion', label: 'Hip flexion' },
  { key: 'hip_extension', label: 'Hip extension' },
  { key: 'hamstring_length', label: 'Hamstring length' },
  { key: 'thoracic_rotation', label: 'Thoracic rotation' },
  { key: 'shoulder_mobility', label: 'Shoulder mobility' },
  { key: 'overhead_squat', label: 'Overhead squat' },
])

const NOTES_MAX = 500

const numericForm = (fields, values, notes) => {
  const data = {}
  for (const f of fields) {
    const raw = String(values?.[f.key] ?? '').trim().replace(',', '.')
    if (raw === '') {
      if (f.required) return { error: `${f.label} is required` }
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < f.min || n > f.max) return { error: `${f.label} must be between ${f.min} and ${f.max}` }
    data[f.key] = n
  }
  if (Object.keys(data).length === 0) return { error: 'Enter at least one value' }
  return withNotes(data, notes)
}

function withNotes(data, notes) {
  const t = String(notes || '').trim()
  if (t.length > NOTES_MAX) return { error: `Notes are limited to ${NOTES_MAX} characters` }
  return { data: t ? { ...data, notes: t } : data }
}

/** Validates a form for `kind` and returns { data } ready for lab_field_save, or { error }. */
export function buildFieldData(kind, values = {}, notes = '') {
  if (kind === 'body') return numericForm(BODY_FIELDS, values, notes)
  if (kind === 'sprint') return numericForm(SPRINT_FIELDS, values, notes)
  if (kind === 'mobility') {
    const data = {}
    for (const i of MOBILITY_ITEMS) {
      const v = values?.[i.key]
      if (v === 'pass' || v === 'limited') data[i.key] = v
    }
    if (Object.keys(data).length === 0) return { error: 'Mark at least one joint test' }
    return withNotes(data, notes)
  }
  return { error: 'Unknown test kind' }
}

/** Average sprint speed in km/h from a sprint result. */
export const sprintSpeedKmh = (d) => (d?.distance_m > 0 && d?.time_s > 0 ? Math.round((d.distance_m / d.time_s) * 3.6 * 10) / 10 : null)

const round1 = (n) => Math.round(n * 10) / 10

/** Per-field change between the newest result and the previous one (rows newest first). */
export function fieldDeltas(kind, rows) {
  const list = (rows || []).filter((r) => r.kind === kind)
  if (list.length < 2) return {}
  const [cur, prev] = [list[0].data || {}, list[1].data || {}]
  const out = {}
  if (kind === 'mobility') {
    for (const i of MOBILITY_ITEMS) if (cur[i.key] && prev[i.key] && cur[i.key] !== prev[i.key]) out[i.key] = cur[i.key] === 'pass' ? 'improved' : 'worse'
    return out
  }
  for (const k of Object.keys(cur)) {
    if (k !== 'notes' && typeof cur[k] === 'number' && typeof prev[k] === 'number') out[k] = round1(cur[k] - prev[k])
  }
  return out
}

/** Short one-line summary of a result for the history list. */
export function summarizeField(kind, data = {}) {
  if (kind === 'body') return BODY_FIELDS.filter((f) => data[f.key] != null).map((f) => `${f.label.replace(/ \(.*\)/, '')} ${data[f.key]}`).join(' · ')
  if (kind === 'sprint') {
    const v = sprintSpeedKmh(data)
    return `${data.distance_m} m in ${data.time_s} s${v ? ` (${v} km/h)` : ''}${data.peak_power_w ? ` · peak ${data.peak_power_w} W` : ''}`
  }
  const items = MOBILITY_ITEMS.filter((i) => data[i.key])
  return `${items.filter((i) => data[i.key] === 'pass').length}/${items.length} pass`
}
