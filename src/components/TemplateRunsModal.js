'use client'

// Modal listing the current user's runs of one template (issue #174). Pages are loaded
// lazily from the uncached /api/templates/stats/runs endpoint with search and sorting.

import { CoachRunBadge, useRunCoachNames } from './CoachBadge'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import Portal from './Portal'
import useContextHref from './useContextHref'
import Icon from './Icon'
import { getAuthHeader } from '../lib/supabase'
import { parseJsonResponse } from '../lib/httpJson'
import { RUNS_PAGE_SIZE, metricLabel, orderMetricKeys, formatStatValue } from '../lib/templateStats'

function Inner({ template, metricKeys, filter = 'all', rider = null, athleteName = null, onClose }) {
  const contextHref = useContextHref()
  const [runs, setRuns] = useState([])
  const coachNames = useRunCoachNames(runs)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('date')
  const [dir, setDir] = useState('desc')
  const reqId = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fetchPage = useCallback(
    async (offset) => {
      const id = ++reqId.current
      setLoading(true)
      setError(null)
      try {
        const authHeader = await getAuthHeader()
        const params = new URLSearchParams({ template_id: template.id, filter, sort, dir, limit: String(RUNS_PAGE_SIZE), offset: String(offset) })
        if (rider) params.set('rider', rider)
        if (q) params.set('q', q)
        const res = await fetch(`/api/templates/stats/runs?${params}`, { headers: authHeader, cache: 'no-store' })
        const json = await parseJsonResponse(res)
        if (!res.ok || json.error) throw new Error(json.error || 'Failed to load runs.')
        if (id !== reqId.current) return
        setRuns((prev) => (offset === 0 ? json.runs : [...prev, ...json.runs]))
        setTotal(json.total)
        setHasMore(json.hasMore)
      } catch (err) {
        if (id === reqId.current) setError(err.message)
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    },
    [template.id, sort, dir, q, filter, rider]
  )

  useEffect(() => {
    setRuns([])
    fetchPage(0)
  }, [fetchPage])

  const field =
    'bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Runs of ${template.name}`}
        className="glass-modal w-full max-w-2xl max-h-[90vh] flex flex-col bg-white dark:bg-surface-darkCard rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xl p-4 sm:p-6 gap-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white truncate">
            {template.name} · {rider ? `your runs on ${athleteName || 'this athlete'}` : 'runs'}{total > 0 && !loading ? ` (${total})` : ''}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs font-bold shrink-0">
            <Icon name="close" /> Close
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity title…"
            aria-label="Search activity title"
            className={`${field} flex-1 min-w-[10rem]`}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={field} aria-label="Sort runs by">
            <option value="date">Sort: Date</option>
            {metricKeys.map((k) => (
              <option key={k} value={k}>
                {metricLabel(k)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
            className={`${field} font-bold`}
            aria-label={dir === 'desc' ? 'Descending' : 'Ascending'}
          >
            <Icon name={dir === 'desc' ? 'chevronDown' : 'chevronUp'} />
          </button>
        </div>

        <div className="overflow-y-auto min-h-[8rem] flex-1">
          {error && (
            <div className="text-xs font-bold text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-center justify-between gap-3">
              <span>{error}</span>
              <button onClick={() => fetchPage(runs.length)} className="underline">Retry</button>
            </div>
          )}
          {!error && !loading && runs.length === 0 && (
            <p className="text-sm text-slate-400 text-center p-8">{q ? 'No runs match your search.' : 'No runs yet.'}</p>
          )}
          <ul className="space-y-2">
            {runs.map((r) => (
              <li key={r.id} className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3 text-[11px]">
                <Link href={contextHref(`/activities/${r.activity_id}`)} className="text-sm font-bold text-slate-800 dark:text-slate-100 hover:text-emerald-500 break-words">
                  {r.title || 'Untitled activity'}
                </Link>
                <CoachRunBadge run={r} names={coachNames} />
                {r.date && <span className="text-slate-400"> · {new Date(r.date).toLocaleDateString()}</span>}
                <div className="text-slate-500 dark:text-slate-400">
                  {orderMetricKeys(Object.keys(r.metrics))
                    .slice(0, 6)
                    .map((k) => `${metricLabel(k)} ${formatStatValue(k, r.metrics[k])}`)
                    .join(' · ')}
                </div>
              </li>
            ))}
          </ul>
          {loading && <p className="text-sm text-slate-400 text-center p-4">Loading runs…</p>}
          {!loading && !error && hasMore && (
            <button onClick={() => fetchPage(runs.length)} className="mt-3 w-full py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
              Load more
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TemplateRunsModal(props) {
  return (
    <Portal>
      <Inner {...props} />
    </Portal>
  )
}
