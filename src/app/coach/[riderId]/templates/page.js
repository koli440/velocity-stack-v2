'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { parseJsonResponse } from '../../../../lib/httpJson'
import { useAthlete } from '../../../../components/AthleteContext'
import TemplateRunsModal from '../../../../components/TemplateRunsModal'
import TemplateBatchRunner from '../../../../components/TemplateBatchRunner'
import { metricLabel, orderMetricKeys, formatStatValue } from '../../../../lib/templateStats'
import { athleteTemplateGroups, coachRunnableTemplates } from '../../../../lib/coachRuns'

// Coach in athlete context: the template runs THE COACH made on THIS athlete's activities, grouped by
// template (own + system). Read through /api/templates/stats?rider=, which only returns runs stamped
// with the coach's id (RLS additionally requires an active coaching relationship). Template
// definitions of the athlete are not shown; the athlete's own runs never appear here.
export default function AthleteTemplatesPage() {
  const { riderId, athlete } = useAthlete()
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [runsFor, setRunsFor] = useState(null)
  const [runnable, setRunnable] = useState([])
  const [pick, setPick] = useState('')
  const [batchFor, setBatchFor] = useState(null)
  const athleteName = athlete?.display_name || 'this athlete'

  const load = useCallback(async () => {
    if (!riderId) return
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const authHeader = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
      const statsRes = await fetch(`/api/templates/stats?rider=${riderId}`, { headers: authHeader, cache: 'no-store' })
      const stats = await parseJsonResponse(statsRes)
      if (!statsRes.ok || stats.error) throw new Error(stats.error || 'Failed to load runs.')
      setState({
        groups: athleteTemplateGroups(stats.stats, stats.names, stats.templates || [], session?.user?.id),
      })
      // Own + system templates only: the coach cannot run the athlete's or other people's templates.
      const tplRes = await fetch('/api/templates', { headers: authHeader, cache: 'no-store' })
      const tpl = await parseJsonResponse(tplRes)
      if (tplRes.ok && !tpl.error) setRunnable(coachRunnableTemplates(tpl.templates, session?.user?.id))
    } catch (err) {
      setError(err.message)
      setState({ groups: [] })
    }
  }, [riderId])

  useEffect(() => {
    load()
  }, [load])

  if (!state) {
    return (
      <section className="space-y-3" data-testid="athlete-templates-loading" aria-busy="true">
        <div className="h-6 w-56 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-36 rounded-2xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
          ))}
        </div>
      </section>
    )
  }
  return (
    <section className="space-y-3" data-testid="athlete-templates">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Templates · {athleteName}</h1>
        <p className="text-xs text-slate-500">
          Template runs you made on {athleteName}&apos;s activities. Only your own runs are listed; they are not part of your own template statistics.
        </p>
      </div>
      {runnable.length > 0 && (
        <div className="flex flex-wrap items-end gap-2" data-testid="athlete-batch-run">
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor="batch-template" className="text-xs font-bold text-slate-500">Run a template on several activities</label>
            <select id="batch-template" value={pick} onChange={(e) => setPick(e.target.value)} className="mt-1 w-full bg-slate-50 dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white">
              <option value="">Choose a template…</option>
              {runnable.map((t) => <option key={t.id} value={t.id}>{t.name}{t.user_id ? '' : ' (system)'}</option>)}
            </select>
          </div>
          <button onClick={() => setBatchFor(runnable.find((t) => t.id === pick) || null)} disabled={!pick} aria-haspopup="dialog" className="py-2 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-[11px] uppercase tracking-wider disabled:opacity-40">
            Run on activities…
          </button>
        </div>
      )}
      {error && (
        <div className="text-xs font-bold text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex justify-between gap-3">
          <span>{error}</span>
          <button onClick={load} className="underline">Retry</button>
        </div>
      )}
      {!error && state.groups.length === 0 && (
        <p className="text-sm text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 text-center">
          You have not run any template on {athleteName}&apos;s activities yet. Open an activity and run one of your templates or a system template.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {state.groups.map((g) => {
          const keys = orderMetricKeys(Object.keys(g.stat.metrics))
          return (
            <div key={g.id} className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm flex flex-col gap-2 text-[11px]">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">{g.name}</h3>
              <div className="flex flex-wrap gap-1.5 text-[10px] font-black uppercase tracking-wider">
                {g.category && <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">{g.category}</span>}
                <span className="px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-500">{g.source}</span>
              </div>
              <p className="font-bold text-slate-700 dark:text-slate-200">
                Run {g.stat.count} {g.stat.count === 1 ? 'time' : 'times'} on {athleteName}
                {g.stat.last_run_at && <span className="font-normal text-slate-400"> · last {new Date(g.stat.last_run_at).toLocaleDateString()}</span>}
              </p>
              {keys.length > 0 && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-500 dark:text-slate-400">
                  {keys.map((k) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span>{metricLabel(k)}</span>
                      <span className="font-mono text-slate-700 dark:text-slate-200">{formatStatValue(k, g.stat.metrics[k].avg)}</span>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => setRunsFor(g)} className="self-start font-bold text-emerald-500 hover:underline" aria-haspopup="dialog">
                View {g.stat.count} {g.stat.count === 1 ? 'run' : 'runs'}
              </button>
            </div>
          )
        })}
      </div>
      {batchFor && <TemplateBatchRunner template={batchFor} rider={riderId} athleteName={athleteName} onClose={() => setBatchFor(null)} onDone={load} />}
      {runsFor && (
        <TemplateRunsModal
          template={runsFor}
          rider={riderId}
          athleteName={athleteName}
          metricKeys={orderMetricKeys(Object.keys(runsFor.stat.metrics))}
          onClose={() => setRunsFor(null)}
        />
      )}
    </section>
  )
}
