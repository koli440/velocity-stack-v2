'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase, getAuthHeader } from '../lib/supabase'
import { parseJsonResponse } from '../lib/httpJson'
import {
  CONNECTION_PUBLIC_COLUMNS,
  DEFAULT_BACKFILL_DAYS,
  connectionStatusLabel,
  isConnected,
} from '../lib/connections'

const BACKFILL_OPTIONS = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last year' },
  { value: 'full', label: 'Full history' },
]

const inputCls =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 font-mono'

function backfillToValue(days) {
  return days === null || days === undefined ? 'full' : String(days)
}

async function callIntervals(method, body) {
  const res = await fetch('/api/connections/intervals', {
    method,
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export default function ConnectionsPanel({ userId }) {
  const [conn, setConn] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [athleteId, setAthleteId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [backfill, setBackfill] = useState(String(DEFAULT_BACKFILL_DAYS))

  const load = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase
      .from('connections')
      .select(CONNECTION_PUBLIC_COLUMNS)
      .eq('user_id', userId)
      .eq('provider', 'intervals')
      .maybeSingle()
    let row = data
    if (!row) {
      // Legacy credentials not yet migrated to a connection still count as connected.
      const { data: legacy } = await supabase
        .from('profile_secrets')
        .select('intervals_athlete_id, intervals_api_key')
        .eq('user_id', userId)
        .maybeSingle()
      if (legacy?.intervals_athlete_id && legacy?.intervals_api_key) {
        row = { status: 'active', external_athlete_id: legacy.intervals_athlete_id, backfill_days: DEFAULT_BACKFILL_DAYS }
      }
    }
    setConn(row)
    if (row) setBackfill(backfillToValue(row.backfill_days))
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const backfillPayload = (v) => (v === 'full' ? null : Number(v))
  const connected = isConnected(conn)

  return (
    <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base">🔄</span>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
          Connections
        </h3>
      </div>

      {/* Intervals.icu */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-100">Intervals.icu</span>
          <span
            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
              conn?.status === 'error'
                ? 'bg-red-500/15 text-red-500'
                : connected
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : 'bg-slate-500/15 text-slate-400'
            }`}
          >
            {loading ? '...' : connectionStatusLabel(conn)}
          </span>
        </div>
        <p className="text-[11px] text-slate-400">
          Import rides from Garmin & Wahoo devices via your Intervals.icu account.
        </p>

        {connected ? (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500 dark:text-slate-300">
              Athlete {conn.external_athlete_id || '—'} · Last sync:{' '}
              {conn.last_synced_at ? new Date(conn.last_synced_at).toLocaleString() : 'never'}
            </p>
            {conn.last_error && <p className="text-[11px] text-red-500">Last error: {conn.last_error}</p>}
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Import history</label>
              <select
                value={backfill}
                disabled={busy}
                onChange={(e) => {
                  const v = e.target.value
                  setBackfill(v)
                  run(() => callIntervals('PATCH', { backfillDays: backfillPayload(v) }))
                }}
                className={inputCls}
              >
                {BACKFILL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => callIntervals('DELETE'))}
              className="text-[11px] font-bold uppercase text-red-500 hover:text-red-400 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                  Athlete ID (e.g. i228280)
                </label>
                <input
                  type="text"
                  value={athleteId}
                  onChange={(e) => setAthleteId(e.target.value)}
                  placeholder="iXXXXX"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="From intervals.icu settings"
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Import history</label>
              <select value={backfill} onChange={(e) => setBackfill(e.target.value)} className={inputCls}>
                {BACKFILL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={busy || !athleteId.trim() || !apiKey.trim()}
              onClick={() =>
                run(async () => {
                  await callIntervals('POST', { athleteId, apiKey, backfillDays: backfillPayload(backfill) })
                  setApiKey('')
                  setAthleteId('')
                })
              }
              className="px-3 py-2 rounded-xl bg-slate-900 dark:bg-emerald-500 text-white dark:text-slate-950 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50"
            >
              {busy ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        )}
        {error && <p className="text-[11px] text-red-500">{error}</p>}
      </div>

      {/* TODO(#109 step 5): wire Strava OAuth here. */}
      <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Strava</span>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-400">
          Coming soon
        </span>
      </div>
    </div>
  )
}
