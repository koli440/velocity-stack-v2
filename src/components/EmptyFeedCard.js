'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { callIntervals, startStravaAuthorize, runProviderSync, fetchConnection } from '../lib/connectionsClient'
import { emptyFeedState } from '../lib/emptyFeed'
import { backfillProgressText, describeSyncResult } from '../lib/syncPlan'
import { syncHealth } from '../lib/connections'
import { OPEN_ADD_SESSION_EVENT } from '../lib/navigation'

const POLL_MS = 15000
const PROVIDERS = ['strava', 'intervals']

const inputCls =
  'w-full bg-white/80 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-mono'

const linkBtn = 'text-xs font-bold text-orange-500 hover:text-orange-600 underline-offset-2 hover:underline transition'
const primaryBtn =
  'px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white disabled:opacity-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2'

// Welcome card for the "My sessions" feed while the rider has no activities yet.
export default function EmptyFeedCard({ userId, activitiesLoaded, activityCount, onRefresh, notice }) {
  const [connections, setConnections] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [syncMsg, setSyncMsg] = useState(notice && !notice.isError ? notice.text : null)
  const [showIntervals, setShowIntervals] = useState(false)
  const [athleteId, setAthleteId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const kicked = useRef(false)

  const load = useCallback(async () => {
    if (!userId) return
    const rows = await Promise.all(PROVIDERS.map((p) => fetchConnection(userId, p).catch(() => null)))
    setConnections(rows.filter(Boolean))
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  const state = emptyFeedState({ activityCount, connections, activitiesLoaded })
  const waiting = state === 'importing' || state === 'connected'

  // Keep checking for the first rides to arrive; the feed replaces this card once they do.
  useEffect(() => {
    if (!waiting) return undefined
    const t = setInterval(() => {
      load()
      onRefresh?.()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [waiting, load, onRefresh])

  const syncProviders = useCallback(
    async (providers) => {
      const results = await Promise.all(providers.map((p) => runProviderSync(p).catch(() => null)))
      const last = results.find((r) => r && r.status === 429) || results.find((r) => r?.ok)
      if (last) setSyncMsg(last.status === 429 ? last.data.error : describeSyncResult(last.data))
      await load()
      onRefresh?.()
    },
    [load, onRefresh]
  )

  // Returning from Strava OAuth: kick off the first import right away instead of waiting for the cron.
  useEffect(() => {
    if (kicked.current || !notice || notice.isError || !userId) return
    kicked.current = true
    syncProviders(['strava'])
  }, [notice, userId, syncProviders])

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const connectStrava = () => run(() => startStravaAuthorize({ returnTo: 'home' }))

  const connectIntervals = (e) => {
    e.preventDefault()
    return run(async () => {
      await callIntervals('POST', { athleteId, apiKey })
      setApiKey('')
      setAthleteId('')
      setShowIntervals(false)
      await syncProviders(['intervals'])
    })
  }

  const syncNow = () =>
    run(async () => {
      setSyncMsg(null)
      await syncProviders(connections.map((c) => c.provider).filter(Boolean))
    })

  if (state === 'hidden') return null

  const openAdd = () => window.dispatchEvent(new Event(OPEN_ADD_SESSION_EVENT))
  const progress = connections?.map(backfillProgressText).find(Boolean)
  const health = connections?.map((c) => syncHealth(c)).find((h) => h && h.level !== 'ok')

  return (
    <section
      aria-labelledby="empty-feed-title"
      className="glass-card rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder p-5 sm:p-7 space-y-4"
    >
      {notice?.isError && (
        <p role="alert" className="text-xs font-bold text-red-500">
          {notice.text}
        </p>
      )}

      {state === 'connect' ? (
        <>
          <div className="space-y-1">
            <h2 id="empty-feed-title" className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
              Welcome! Let’s get your rides in
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Connect an account and your rides are pulled in automatically — no manual uploads needed.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button type="button" disabled={busy} onClick={connectStrava} className={`${primaryBtn} bg-[#fc4c02] hover:bg-[#e04400]`}>
              {busy ? 'Redirecting…' : 'Connect Strava'}
            </button>
            <button
              type="button"
              aria-expanded={showIntervals}
              aria-controls="empty-feed-intervals"
              onClick={() => setShowIntervals((v) => !v)}
              className={`${primaryBtn} bg-slate-900 dark:bg-emerald-500 dark:text-slate-950 hover:opacity-90`}
            >
              Connect Intervals.icu
            </button>
          </div>

          {showIntervals && (
            <form id="empty-feed-intervals" onSubmit={connectIntervals} className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ef-athlete" className="block text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 mb-1">
                    Athlete ID (e.g. i228280)
                  </label>
                  <input id="ef-athlete" type="text" value={athleteId} onChange={(e) => setAthleteId(e.target.value)} placeholder="iXXXXX" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="ef-key" className="block text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 mb-1">
                    API Key
                  </label>
                  <input id="ef-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="From intervals.icu settings" className={inputCls} />
                </div>
              </div>
              <button
                type="submit"
                disabled={busy || !athleteId.trim() || !apiKey.trim()}
                className="px-3 py-2 rounded-xl bg-slate-900 dark:bg-emerald-500 text-white dark:text-slate-950 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50"
              >
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </form>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
            <button type="button" onClick={openAdd} className={linkBtn}>Upload .fit</button>
            <button type="button" onClick={openAdd} className={linkBtn}>Import history</button>
            <Link href="/settings" className={linkBtn}>More options in Settings</Link>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <h2 id="empty-feed-title" className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
              {state === 'importing' ? 'Importing your rides…' : 'Connected — no rides yet'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {state === 'importing'
                ? 'Your history is coming in, newest first. This page updates by itself.'
                : 'Your account is connected, but no rides have come in yet. Sync again or upload a file.'}
            </p>
          </div>

          <div role="status" aria-live="polite" className="space-y-1">
            {progress && <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{progress}</p>}
            {health && <p className={`text-xs font-bold ${health.level === 'error' ? 'text-red-500' : 'text-amber-500'}`}>● {health.text}</p>}
            {syncMsg && <p className="text-xs text-slate-500 dark:text-slate-300">{syncMsg}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" disabled={busy} onClick={syncNow} className={`${primaryBtn} bg-slate-900 dark:bg-emerald-500 dark:text-slate-950`}>
              {busy ? 'Syncing…' : state === 'importing' ? 'Sync now' : 'Retry sync'}
            </button>
            <button type="button" onClick={openAdd} className={linkBtn}>Upload .fit</button>
            <Link href="/settings" className={linkBtn}>Connection settings</Link>
          </div>
        </>
      )}

      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    </section>
  )
}
