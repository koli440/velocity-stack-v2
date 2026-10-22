'use client'

// "Run on activities" dialog (issue #293): search activities by name, collect them in an
// "activities to analyse" list (max 50), run one template on all of them in small server requests and
// show progress plus a result summary. `rider` set = coach in athlete context (coach-safe paths).

import { useEffect, useRef, useState } from 'react'
import Portal from './Portal'
import Icon from './Icon'
import { supabase, getAuthHeader } from '../lib/supabase'
import { parseJsonResponse } from '../lib/httpJson'
import {
  MAX_BATCH_ACTIVITIES, STATUS_LABELS, addActivity, removeActivity, searchActivities, runInChunks, summarizeBatch,
} from '../lib/templateBatch'

const field =
  'bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500'
const STATUS_STYLE = { ok: 'text-emerald-500', no_match: 'text-amber-500', skipped: 'text-slate-500', failed: 'text-red-500' }

export default function TemplateBatchRunner({ template, rider = null, athleteName = null, onClose, onDone }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [list, setList] = useState([])
  const [listNote, setListNote] = useState(null)
  const [phase, setPhase] = useState('edit')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [items, setItems] = useState([])
  const stop = useRef(false)
  const reqId = useRef(0)
  const running = phase === 'running'

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !running && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, running])

  useEffect(() => () => { stop.current = true }, [])

  useEffect(() => {
    const q = search.trim()
    if (!q) { setResults([]); setSearchError(null); return undefined }
    const t = setTimeout(async () => {
      const id = ++reqId.current
      setSearching(true)
      setSearchError(null)
      const { data: { session } } = await supabase.auth.getSession()
      const ownerId = rider || session?.user?.id
      const { data, error } = await searchActivities(supabase, { ownerId, shared: !!rider, query: q })
      if (id !== reqId.current) return
      setSearching(false)
      if (error) setSearchError(error.message || 'Search failed.')
      setResults(data)
    }, 300)
    return () => clearTimeout(t)
  }, [search, rider])

  const add = (a) => {
    const r = addActivity(list, a)
    setList(r.list)
    setListNote(r.error)
  }

  const post = async (ids) => {
    const res = await fetch('/api/templates/run-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify({ templateId: template.id, activityIds: ids, ...(rider ? { rider } : {}) }),
    })
    const json = await parseJsonResponse(res)
    if (!res.ok || json.error) throw new Error(json.error || 'Request failed.')
    return json.items
  }

  const start = async () => {
    stop.current = false
    setPhase('running')
    setItems([])
    setProgress({ done: 0, total: list.length })
    const out = await runInChunks(list.map((a) => a.id), post, {
      onProgress: ({ done, total, items: soFar }) => { setProgress({ done, total }); setItems(soFar) },
      shouldStop: () => stop.current,
    })
    setItems(out)
    setPhase('done')
    onDone?.()
  }

  const title = (id) => list.find((a) => a.id === id)?.title || 'Activity'
  const counts = summarizeBatch(items)
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const problems = items.filter((i) => i.status !== 'ok')

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !running && onClose()}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Run ${template.name} on activities`}
          className="glass-modal w-full max-w-2xl max-h-[92vh] flex flex-col bg-white dark:bg-surface-darkCard rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xl p-4 sm:p-6 gap-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white truncate">
              {template.name} · run on activities{athleteName ? ` of ${athleteName}` : ''}
            </h2>
            <button type="button" onClick={onClose} disabled={running} className="text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs font-bold shrink-0 disabled:opacity-40">
              <Icon name="close" /> Close
            </button>
          </div>

          <div className="overflow-y-auto flex-1 space-y-4 min-h-[10rem]">
            {phase === 'edit' && (
              <>
                <div>
                  <label htmlFor="batch-search" className="text-xs font-bold text-slate-500">Search activities by name</label>
                  <input id="batch-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. threshold" className={`${field} w-full mt-1`} autoComplete="off" />
                  <div aria-live="polite" className="text-[11px] text-slate-400 mt-1 min-h-[1rem]">
                    {searching ? 'Searching…' : searchError ? <span className="text-red-500">{searchError}</span> : search.trim() && results.length === 0 ? 'No activities found.' : ''}
                  </div>
                  {results.length > 0 && (
                    <ul className="space-y-1 mt-1" aria-label="Search results">
                      {results.map((a) => {
                        const inList = list.some((x) => x.id === a.id)
                        return (
                          <li key={a.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-xs">
                            <span className="min-w-0 break-words font-bold text-slate-800 dark:text-slate-100">
                              {a.title || 'Untitled activity'}
                              {a.activity_date && <span className="font-normal text-slate-400"> · {new Date(a.activity_date).toLocaleDateString()}</span>}
                            </span>
                            <button type="button" onClick={() => add(a)} disabled={inList} aria-label={`Add ${a.title || 'activity'} to the list`} className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-bold text-emerald-500 disabled:text-slate-400 disabled:opacity-60">
                              {inList ? 'Added' : 'Add'}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
                    Activities to analyse ({list.length}/{MAX_BATCH_ACTIVITIES})
                  </h3>
                  <p role="status" className="text-[11px] text-amber-500 min-h-[1rem]">{listNote}</p>
                  {list.length === 0 ? (
                    <p className="text-sm text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-5 text-center">Search and add the activities you want to run this template on.</p>
                  ) : (
                    <ul className="space-y-1" aria-label="Activities to analyse">
                      {list.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-xs">
                          <span className="min-w-0 break-words text-slate-800 dark:text-slate-100">
                            {a.title}
                            {a.activity_date && <span className="text-slate-400"> · {new Date(a.activity_date).toLocaleDateString()}</span>}
                          </span>
                          <button type="button" onClick={() => { setList(removeActivity(list, a.id)); setListNote(null) }} aria-label={`Remove ${a.title} from the list`} className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-bold text-red-500">
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-slate-400 mt-2">An activity that already has a run of this template is re-run: its result is replaced, no duplicate is created.</p>
                </div>
              </>
            )}

            {phase !== 'edit' && (
              <div className="space-y-3" aria-live="polite">
                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
                    <span>{running ? 'Running…' : 'Finished'}</span>
                    <span>{progress.done} / {progress.total}</span>
                  </div>
                  <div role="progressbar" aria-label="Batch progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden mt-1">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="batch-summary">
                  <b className="text-emerald-500">{counts.ok} done</b>
                  {counts.replaced > 0 && ` (${counts.replaced} re-run)`} · {counts.no_match} no matching efforts · {counts.skipped} skipped · <span className={counts.failed ? 'text-red-500 font-bold' : ''}>{counts.failed} failed</span>
                </p>
                {problems.length > 0 && (
                  <ul className="space-y-1" aria-label="Activities that need attention">
                    {problems.map((i) => (
                      <li key={i.activity_id} className="rounded-xl bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-[11px] break-words">
                        <span className="font-bold text-slate-800 dark:text-slate-100">{title(i.activity_id)}</span>
                        <span className={`font-bold ${STATUS_STYLE[i.status]}`}> · {STATUS_LABELS[i.status]}</span>
                        {i.reason && <span className="text-slate-500"> — {i.reason}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {phase === 'edit' && (
              <button type="button" onClick={start} disabled={list.length === 0} className="py-2 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-[11px] uppercase tracking-wider disabled:opacity-40">
                Run on {list.length} {list.length === 1 ? 'activity' : 'activities'}
              </button>
            )}
            {running && (
              <button type="button" onClick={() => { stop.current = true }} className="py-2 px-4 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-[11px] text-slate-600 dark:text-slate-300">
                Stop after current step
              </button>
            )}
            {phase === 'done' && (
              <>
                <button type="button" onClick={() => { setPhase('edit'); setItems([]); setList([]) }} className="py-2 px-4 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-[11px] text-slate-600 dark:text-slate-300">Run another batch</button>
                <button type="button" onClick={onClose} className="py-2 px-4 rounded-xl bg-emerald-500 text-white font-black text-[11px] uppercase tracking-wider">Done</button>
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  )
}
