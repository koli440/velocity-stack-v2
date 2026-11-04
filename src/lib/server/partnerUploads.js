// src/lib/server/partnerUploads.js
//
// Partner upload orchestration: validates the request, keeps one partner_uploads row per
// (app, rider, external_id) so retries are idempotent, then runs the shared import pipeline.
// Uses the service-role client; every query is scoped to the token's own user id.

import { importActivity } from './importActivity.js'
import { ImportError } from './importErrors.js'
import { createPartnerProvider } from './partnerProvider.js'
import {
  parseJsonUpload, validateExternalId, validateSport, validateTitle, validateStartTime, fileExtension,
  UploadValidationError, MAX_FILE_BYTES, FILE_EXTENSIONS, parseGpx, parseTcx,
} from '../partnerUpload.js'

const UNIQUE_VIOLATION = '23505'

/** Turns the raw request (JSON body or multipart form) into { kind, externalId, title, sport, input }. */
export async function readUploadRequest(req) {
  const ct = req.headers.get('content-type') || ''
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') throw new UploadValidationError('file is required')
    if (file.size > MAX_FILE_BYTES) throw new UploadValidationError('File is larger than 10 MB', 413, 'too_large')
    if (!file.size) throw new UploadValidationError('File is empty')
    const ext = fileExtension(file.name)
    if (!FILE_EXTENSIONS.includes(ext)) throw new UploadValidationError('file must be .fit, .tcx or .gpx')
    const startRaw = form.get('start_time')
    const start = startRaw ? validateStartTime(startRaw) : undefined
    const common = {
      externalId: validateExternalId(form.get('external_id')),
      title: validateTitle(form.get('title') ?? form.get('name')),
      sport: form.get('sport') ? validateSport(form.get('sport')) : null,
    }
    if (ext === 'fit') return { ...common, kind: 'fit', input: { kind: 'fit', blob: file, filename: `${common.externalId}.fit`, start } }
    const text = await file.text()
    if (ext === 'gpx') parseGpx(text)
    else parseTcx(text) // validate early so bad files fail with a 422 before any row is written
    return { ...common, kind: ext, input: { kind: 'xml', text, ext, start } }
  }
  if (ct.includes('application/json')) {
    const raw = await req.text()
    if (raw.length > 8 * 1024 * 1024) throw new UploadValidationError('Body is larger than 8 MB', 413, 'too_large')
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      throw new UploadValidationError('Invalid JSON')
    }
    const p = parseJsonUpload(body)
    return {
      kind: 'json', externalId: p.externalId, title: p.title, sport: p.sport,
      input: { kind: 'json', streams: p.streams, samples: p.samples, start: p.start },
    }
  }
  throw new UploadValidationError('Content-Type must be application/json or multipart/form-data', 415, 'unsupported_media_type')
}

/**
 * @returns {Promise<{ replay: boolean, row: object }>} the upload row after processing (or the earlier one when the
 *   same external_id was already uploaded)
 */
export async function processUpload({ service, auth, request, analyzeFit, log = console }) {
  const { userId, appId, app } = auth
  const base = { app_id: appId, user_id: userId, external_id: request.externalId }

  const { data: inserted, error } = await service
    .from('partner_uploads')
    .insert({ ...base, kind: request.kind })
    .select()
    .single()

  let row = inserted
  if (error) {
    if (error.code !== UNIQUE_VIOLATION) throw new ImportError(error.message, 500)
    const { data: prior } = await service.from('partner_uploads').select('*').match(base).maybeSingle()
    if (!prior) throw new ImportError('Upload could not be recorded', 500)
    // A failed upload may be retried; anything else is returned as it was (idempotent).
    if (prior.status !== 'failed') return { replay: true, row: prior }
    const { data: retry } = await service
      .from('partner_uploads')
      .update({ status: 'processing', error: null, kind: request.kind, updated_at: new Date().toISOString() })
      .eq('id', prior.id)
      .select()
      .single()
    row = retry || prior
  }

  const provider = createPartnerProvider({ slug: app.slug, input: request.input, title: request.title, sport: request.sport })
  let patch
  try {
    const result = await importActivity({ supabase: service, userId, provider, externalId: request.externalId, analyzeFit })
    patch =
      result.status === 'skipped'
        ? { status: 'duplicate', error: 'An identical or overlapping activity already exists.' }
        : { status: 'completed', activity_id: result.activity?.id ?? null }
  } catch (err) {
    const message = err instanceof ImportError || err instanceof UploadValidationError ? err.message : 'Import failed'
    if (!(err instanceof ImportError || err instanceof UploadValidationError)) log.warn?.('Partner upload failed:', err?.message)
    patch = { status: 'failed', error: message.slice(0, 300) }
  }

  const { data: done } = await service
    .from('partner_uploads')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .select()
    .single()
  log.info?.(`Partner upload ${done?.status ?? patch.status} (app ${app.slug}, kind ${request.kind})`)
  await service.from('partner_audit_log').insert({
    app_id: appId, user_id: userId, event: `upload_${patch.status}`, metadata: { kind: request.kind, upload_id: row.id },
  })
  return { replay: false, row: done || { ...row, ...patch } }
}
