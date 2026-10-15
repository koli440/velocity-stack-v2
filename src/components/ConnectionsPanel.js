'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase, getAuthHeader } from '../lib/supabase'
import { parseJsonResponse } from '../lib/httpJson'
import {
  CONNECTION_PUBLIC_COLUMNS,
  DEFAULT_BACKFILL_DAYS,
  connectionStatusLabel,
  isConnected,
  syncHealth,
} from '../lib/connections'
import { describeSyncResult, backfillProgressText } from '../lib/syncPlan'
import Icon from './Icon'

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

const HEALTH_CLS = { ok: 'text-emerald-500', warn: 'text-amber-500', error: 'text-red-500' }

function HealthLine({ conn }) {
  const h = syncHealth(conn)
  if (!h) return null
  const progress = backfillProgressText(conn)
  return (
    <>
      <p className={`text-[11px] font-bold ${HEALTH_CLS[h.level]}`}>● {h.text}</p>
      {progress && <p className="text-[11px] text-slate-500 dark:text-slate-300">{progress}</p>}
    </>
  )
}

// Re-reads the connection while history is still being imported so the progress line moves.
function useBackfillRefresh(conn, load) {
  const importing = !!backfillProgressText(conn)
  useEffect(() => {
    if (!importing) return undefined
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [importing, load])
}

const STRAVA_FLAGS = {
  connected: ['Strava connected. Importing your rides…', false],
  denied: ['Strava authorization was cancelled.', true],
  missing_scope: ['Please allow access to your activities on Strava and try again.', true],
  invalid_state: ['The Strava connection request expired. Please try again.', true],
  not_configured: ['Strava is not configured on this deployment.', true],
  error: ['Could not connect Strava. Please try again.', true],
}

async function callStrava(method, body) {
  const res = await fetch('/api/connections/strava', {
    method,
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

function StravaCard({ userId }) {
  const [conn, setConn] = useState(null)
  const [configured, setConfigured] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [syncMsg, setSyncMsg] = useState(null)
  const [backfill, setBackfill] = useState(String(DEFAULT_BACKFILL_DAYS))

  const load = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase
      .from('connections')
      .select(CONNECTION_PUBLIC_COLUMNS)
      .eq('user_id', userId)
      .eq('provider', 'strava')
      .maybeSingle()
    setConn(data)
    if (data) setBackfill(backfillToValue(data.backfill_days))
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
  }, [load])
  useBackfillRefresh(conn, load)

  useEffect(() => {
    fetch('/api/connections/strava')
      .then((r) => r.json())
      .then((d) => setConfigured(!!d.configured))
      .catch(() => setConfigured(false))
  }, [])

  // Result of the OAuth round trip (?strava=connected|denied|...), shown once and removed from the URL.
  useEffect(() => {
    const url = new URL(window.location.href)
    const flag = url.searchParams.get('strava')
    if (!flag) return
    const [msg, isErr] = STRAVA_FLAGS[flag] || STRAVA_FLAGS.error
    if (isErr) setError(msg)
    else setSyncMsg(msg)
    url.searchParams.delete('strava')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  }, [])

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

  const connect = () =>
    run(async () => {
      const res = await fetch('/api/connections/strava/authorize', { headers: await getAuthHeader() })
      const data = await parseJsonResponse(res)
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start Strava authorization')
      window.location.href = data.url
    })

  const syncNow = () =>
    run(async () => {
      setSyncMsg(null)
      const res = await fetch('/api/sync/strava/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: '{}',
      })
      const data = await parseJsonResponse(res)
      if (res.status === 429) {
        setSyncMsg(data.error)
        return
      }
      if (!res.ok && !data.error) throw new Error('Sync failed')
      setSyncMsg(describeSyncResult(data))
    })

  const connected = isConnected(conn)

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-800 dark:text-slate-100">Strava</span>
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
        Import rides from Strava automatically. Rides that also come from Intervals.icu are kept once, from Intervals.icu.
      </p>

      {connected ? (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-300">
            Athlete {conn.external_athlete_id || '—'} · Last sync:{' '}
            {conn.last_synced_at ? new Date(conn.last_synced_at).toLocaleString() : 'never'}
          </p>
          <HealthLine conn={conn} />
          {conn.last_error && (
            <p className={`text-[11px] ${conn.status === 'error' ? 'text-red-500' : 'text-amber-500'}`}>
              {conn.status === 'error' ? 'Sync stopped: ' : 'Last sync issue: '}
              {conn.last_error}
              {conn.status === 'error' ? ' Use Reconnect below to continue syncing.' : ' It will retry automatically.'}
            </p>
          )}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Import history</label>
            <select
              value={backfill}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value
                setBackfill(v)
                run(() => callStrava('PATCH', { backfillDays: v === 'full' ? null : Number(v) }))
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
          <p className="text-[11px] text-slate-400">New rides arrive within moments, with a check about every 15 minutes.</p>
          {syncMsg && <p className="text-[11px] text-slate-500 dark:text-slate-300">{syncMsg}</p>}
          <div className="flex items-center gap-4">
            {conn.status === 'error' ? (
              <button
                type="button"
                disabled={busy || !configured}
                onClick={connect}
                className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-emerald-500 text-white dark:text-slate-950 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50"
              >
                Reconnect
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={syncNow}
                className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-emerald-500 text-white dark:text-slate-950 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50"
              >
                {busy ? 'Working...' : 'Sync now'}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => callStrava('DELETE'))}
              className="text-[11px] font-bold uppercase text-red-500 hover:text-red-400 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : configured === false ? (
        <p className="text-[11px] text-slate-400">
          Strava is not set up on this deployment yet (an administrator needs to add the Strava app credentials).
        </p>
      ) : (
        <button
          type="button"
          disabled={busy || configured === null}
          onClick={connect}
          className="px-3 py-2 rounded-xl bg-[#fc4c02] text-white text-[11px] font-bold uppercase tracking-wider disabled:opacity-50"
        >
          {busy ? 'Redirecting...' : 'Connect with Strava'}
        </button>
      )}
      {syncMsg && !connected && <p className="text-[11px] text-slate-500 dark:text-slate-300">{syncMsg}</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  )
}

export default function ConnectionsPanel({ userId }) {
  const [conn, setConn] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [syncMsg, setSyncMsg] = useState(null)
  const [athleteId, setAthleteId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [backfill, setBackfill] = useState(String(DEFAULT_BACKFILL_DAYS))
  const [reconnecting, setReconnecting] = useState(false)

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
  useBackfillRefresh(conn, load)

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

  const syncNow = () =>
    run(async () => {
      setSyncMsg(null)
      const res = await fetch('/api/sync/intervals/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: '{}',
      })
      const data = await parseJsonResponse(res)
      if (res.status === 429) {
        setSyncMsg(data.error)
        return
      }
      if (!res.ok && !data.error) throw new Error('Sync failed')
      setSyncMsg(describeSyncResult(data))
    })

  const backfillPayload = (v) => (v === 'full' ? null : Number(v))
  const connected = isConnected(conn)
  const showSummary = connected && !reconnecting

  return (
    <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base"><Icon name="refresh" size={18} /></span>
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

        {showSummary ? (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500 dark:text-slate-300">
              Athlete {conn.external_athlete_id || '—'} · Last sync:{' '}
              {conn.last_synced_at ? new Date(conn.last_synced_at).toLocaleString() : 'never'}
            </p>
            <HealthLine conn={conn} />
            {conn.last_error && (
              <p className={`text-[11px] ${conn.status === 'error' ? 'text-red-500' : 'text-amber-500'}`}>
                {conn.status === 'error' ? 'Sync stopped: ' : 'Last sync issue: '}
                {conn.last_error}
                {conn.status === 'error' ? ' Use Reconnect below with a valid API key.' : ' It will retry automatically.'}
              </p>
            )}
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
            <p className="text-[11px] text-slate-400">New rides are imported automatically about every 15 minutes.</p>
            {syncMsg && <p className="text-[11px] text-slate-500 dark:text-slate-300">{syncMsg}</p>}
            <div className="flex items-center gap-4">
              {conn.status === 'error' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReconnecting(true)}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-emerald-500 text-white dark:text-slate-950 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50"
                >
                  Reconnect
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={syncNow}
                className={
                  conn.status === 'error'
                    ? 'text-[11px] font-bold uppercase text-slate-500 hover:text-slate-400 disabled:opacity-50'
                    : 'px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-emerald-500 text-white dark:text-slate-950 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50'
                }
              >
                {busy ? 'Working...' : 'Sync now'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => callIntervals('DELETE'))}
                className="text-[11px] font-bold uppercase text-red-500 hover:text-red-400 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
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
                  setReconnecting(false)
                })
              }
              className="px-3 py-2 rounded-xl bg-slate-900 dark:bg-emerald-500 text-white dark:text-slate-950 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50"
            >
              {busy ? 'Connecting...' : reconnecting ? 'Reconnect' : 'Connect'}
            </button>
            {reconnecting && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setReconnecting(false)}
                className="ml-3 text-[11px] font-bold uppercase text-slate-500 hover:text-slate-400 disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
        )}
        {error && <p className="text-[11px] text-red-500">{error}</p>}
      </div>

      <StravaCard userId={userId} />
    </div>
  )
}
