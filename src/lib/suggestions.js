// Generic suggestion/moderation helpers (issue #176). Admin-approved changes to shared data.

export const ADMIN_CONTACT_EMAIL = 'koli440@gmail.com'

export const SUGGESTION_NOTICE = `Suggestions are reviewed by the administrator (${ADMIN_CONTACT_EMAIL}) and are not applied instantly. You will be notified of the outcome.`

export const STATUS_LABELS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }

export function reviewPath(id) {
  return `/admin/suggestions/${id}`
}

// Field-by-field comparison of a proposal against the current row (null for a new entry).
export function buildDiff(payload, current) {
  return Object.entries(payload || {}).map(([field, proposed]) => {
    const before = current ? (current[field] ?? null) : null
    return {
      field,
      before,
      after: proposed ?? null,
      changed: JSON.stringify(before) !== JSON.stringify(proposed ?? null),
    }
  })
}

export function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export function validateSuggestionInput(input, targets) {
  const target = (targets || []).find((t) => t.entity_type === input?.entity_type)
  if (!target) return { error: 'Unknown suggestion type' }
  const payload = input.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.keys(payload).length) {
    return { error: 'Suggestion is empty' }
  }
  const bad = Object.keys(payload).find((k) => !target.allowed_columns.includes(k))
  if (bad) return { error: `Field "${bad}" cannot be suggested` }
  const targetId = input.target_id == null || input.target_id === '' ? null : String(input.target_id)
  return { value: { entity_type: target.entity_type, target_id: targetId, payload } }
}
