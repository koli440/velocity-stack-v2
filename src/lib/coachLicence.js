// Coach licence verification. Mirrors supabase/migrations/20270155000000_coach_licences.sql; the database is authoritative.
export const EVIDENCE_BUCKET = 'licence-evidence'
export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024
export const EVIDENCE_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

const STATUS_LABELS = {
  unverified: 'Self-declared (not checked)',
  pending: 'Waiting for review',
  verified: 'Verified',
  rejected: 'Rejected',
  expired: 'Expired',
  revoked: 'Revoked',
}
export const licenceStatusLabel = (s) => STATUS_LABELS[s] || s

// Chip for the public card; the database already hides expired/revoked/rejected licences (licence = null).
export function licenceChip(licence) {
  if (!licence) return null
  const text = [licence.body, licence.level].filter(Boolean).join(' ')
  return licence.verified
    ? { verified: true, label: `Verified · ${text}` }
    : { verified: false, label: `Licence (self-declared) · ${text}` }
}

export function validateEvidenceFile(file) {
  if (!file) return 'Choose a file.'
  if (!EVIDENCE_TYPES.includes(file.type)) return 'Use a PDF, JPEG, PNG or WebP file.'
  if (file.size > EVIDENCE_MAX_BYTES) return 'The file must be 5 MB or smaller.'
  return null
}

export function evidencePathFor(userId, fileName) {
  const safe = String(fileName || 'evidence').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|\.{2,}/g, '').slice(-60) || 'evidence'
  return `${userId}/${Date.now()}-${safe}`
}

export function licenceErrorMessage(error) {
  const msg = String(error?.message || '')
  if (/not enabled/i.test(msg)) return 'The coach module is not available for your account yet.'
  if (/unknown licence/i.test(msg)) return 'Pick a body and level from the list.'
  if (/already expired/i.test(msg)) return 'That licence is already expired.'
  if (/invalid evidence/i.test(msg)) return 'The evidence file is not valid. Upload it again.'
  return msg || 'Something went wrong.'
}

export async function fetchLicenceBodies(client) {
  const { data } = await client.rpc('licence_bodies_list')
  return data || []
}
export async function fetchMyLicence(client) {
  const { data, error } = await client.rpc('my_licence')
  return { licence: error ? null : data, error }
}
export async function saveMyLicence(client, { bodyId, level, number, validUntil, evidencePath }) {
  const { data, error } = await client.rpc('save_my_licence', {
    p_body: bodyId, p_level: level, p_number: number || null, p_valid_until: validUntil || null, p_evidence_path: evidencePath || null,
  })
  return { status: data, error }
}
export const deleteMyLicence = async (client) => ({ error: (await client.rpc('delete_my_licence')).error })
export async function uploadEvidence(client, userId, file) {
  const invalid = validateEvidenceFile(file)
  if (invalid) return { path: null, error: { message: invalid } }
  const path = evidencePathFor(userId, file.name)
  const { error } = await client.storage.from(EVIDENCE_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  return { path: error ? null : path, error }
}
export async function fetchLicenceQueue(client) {
  const { data, error } = await client.rpc('admin_licence_queue')
  return { rows: error ? [] : data || [], error }
}
export const reviewLicence = async (client, id, decision, note) => ({ error: (await client.rpc('admin_review_licence', { p_id: id, p_decision: decision, p_note: note || null })).error })
export async function signEvidenceUrl(client, path) {
  const { data } = await client.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 300)
  return data?.signedUrl || null
}
