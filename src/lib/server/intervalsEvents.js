// src/lib/server/intervalsEvents.js
//
// Minimal Intervals.icu calendar-event client (create / update / delete / find by external id).
// Errors are PushError instances with a stable `code`, an HTTP-ish `status`, a user-facing `message`
// and `fatal` (true = stop pushing for this rider until the key is fixed). The API key and the
// Authorization header are never put into messages.

import { intervalsAuthHeader } from './intervalsProvider.js'

export const INTERVALS_BASE_URL = 'https://intervals.icu/api/v1'
const TIMEOUT_MS = 15000

export class PushError extends Error {
  constructor(code, message, { status = 502, fatal = false, retryAfterSec = null } = {}) {
    super(message)
    this.name = 'PushError'
    this.code = code
    this.status = status
    this.fatal = fatal
    this.retryAfterSec = retryAfterSec
  }
}

async function bodySnippet(res) {
  try {
    const text = (await res.text()).replace(/\s+/g, ' ').trim()
    return text.slice(0, 200)
  } catch {
    return ''
  }
}

async function failFromResponse(res, action) {
  switch (true) {
    case res.status === 401:
      return new PushError('invalid_key', 'Intervals.icu rejected your API key. Reconnect Intervals.icu in Settings → Connections with a valid key.', { status: 400, fatal: true })
    case res.status === 403:
      return new PushError('forbidden', 'Your Intervals.icu API key cannot change your calendar (read-only key?). Create a key with write access and reconnect in Settings → Connections.', { status: 400, fatal: true })
    case res.status === 404:
      return new PushError('not_found', 'Intervals.icu could not find that athlete or event.', { status: 404 })
    case res.status === 429: {
      const retry = Number(res.headers?.get?.('retry-after'))
      return new PushError('rate_limited', 'Intervals.icu is rate limiting requests. Try again in a few minutes.', { status: 429, retryAfterSec: Number.isFinite(retry) ? retry : null })
    }
    case res.status === 400 || res.status === 422: {
      const snippet = await bodySnippet(res)
      return new PushError('rejected', `Intervals.icu rejected the workout (${action})${snippet ? `: ${snippet}` : '.'}`, { status: 422 })
    }
    default:
      return new PushError('unavailable', `Intervals.icu is having problems (HTTP ${res.status}). Try again later.`, { status: 502 })
  }
}

/**
 * @param {{ athleteId: string, apiKey: string, fetchImpl?: typeof fetch, baseUrl?: string }} opts
 */
export function createIntervalsEventsClient({ athleteId, apiKey, fetchImpl = fetch, baseUrl = INTERVALS_BASE_URL }) {
  const root = `${baseUrl}/athlete/${encodeURIComponent(athleteId)}/events`

  async function request(method, url, body, action) {
    let res
    try {
      res = await fetchImpl(url, {
        method,
        headers: {
          Authorization: intervalsAuthHeader(apiKey),
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new PushError('unreachable', 'Could not reach Intervals.icu. It will be retried; or try again in a moment.', { status: 502 })
    }
    if (!res.ok) throw await failFromResponse(res, action)
    return res
  }

  const json = async (res) => {
    try {
      return await res.json()
    } catch {
      return null
    }
  }

  return {
    /** Creates the event; returns its id (string). */
    async create(event) {
      const data = await json(await request('POST', root, event, 'create'))
      if (data?.id == null) throw new PushError('unavailable', 'Intervals.icu did not return an event id.', { status: 502 })
      return String(data.id)
    },

    /** Updates an event we created. A 404 surfaces as PushError code 'not_found' (caller recreates). */
    async update(eventId, event) {
      const data = await json(await request('PUT', `${root}/${encodeURIComponent(eventId)}`, event, 'update'))
      return String(data?.id ?? eventId)
    },

    /** GET one event, or null when it does not exist. */
    async get(eventId) {
      try {
        return await json(await request('GET', `${root}/${encodeURIComponent(eventId)}`, null, 'read'))
      } catch (e) {
        if (e instanceof PushError && e.code === 'not_found') return null
        throw e
      }
    },

    /** An event we created earlier (matched on external_id) within a date window, or null. */
    async findByExternalId(externalId, dateFrom, dateTo) {
      const qs = new URLSearchParams({ oldest: dateFrom, newest: dateTo, category: 'WORKOUT' })
      const list = await json(await request('GET', `${root}?${qs}`, null, 'list'))
      const hit = (Array.isArray(list) ? list : []).find((e) => e && e.external_id === externalId)
      return hit?.id != null ? String(hit.id) : null
    },

    /** Deletes the event; an already-missing event counts as deleted. */
    async remove(eventId) {
      try {
        await request('DELETE', `${root}/${encodeURIComponent(eventId)}`, null, 'delete')
      } catch (e) {
        if (e instanceof PushError && e.code === 'not_found') return
        throw e
      }
    },
  }
}
