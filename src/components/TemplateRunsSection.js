'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAuthHeader, supabase } from '../lib/supabase'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import TemplateCreatorModal from './TemplateCreatorModal'

const RUN_COLORS = ['#f59e0b', '#38bdf8', '#d946ef', '#34d399', '#f87171', '#a78bfa']

function formatMetric(value, suffix = '') {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return `${Math.round(value * 10) / 10}${suffix}`
  return `${value}${suffix}`
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('cs-CZ') : ''
}

function DeltaBadge({ current, previous }) {
  if (typeof current !== 'number' || typeof previous !== 'number') return null
  const diff = Math.round((current - previous) * 10) / 10
  if (diff === 0) return null
  return (
    <span className={`ml-1 text-[10px] font-bold ${diff > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
      {diff > 0 ? '▲' : '▼'} {Math.abs(diff)}
    </span>
  )
}

function EffortCards({ efforts }) {
  const val = 'text-slate-700 dark:text-slate-200'
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {efforts.map((eff, idx) => (
        <div
          key={eff.id || idx}
          className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-1"
        >
          <div className="text-xs font-black text-slate-900 dark:text-white">
            {eff.role ? `${eff.role === 'work' ? 'Work' : 'Recovery'} rep ${eff.rep || idx + 1}` : `Effort #${idx + 1}`}{' '}
            ({eff.distance_m != null ? `${eff.distance_m}m` : `${eff.duration_sec}s`})
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-400">
            {eff.target_distance_m != null && <div>Target: <b className={val}>{eff.target_distance_m}m</b></div>}
            {eff.avg_power != null && <div>Avg W: <b className={val}>{eff.avg_power}</b></div>}
            {eff.max_power != null && <div>Max W: <b className={val}>{eff.max_power}</b></div>}
            {eff.avg_speed_kmh != null && <div>Avg speed: <b className={val}>{eff.avg_speed_kmh} km/h</b></div>}
            {eff.pct_of_ftp != null && <div>% FTP: <b className={val}>{eff.pct_of_ftp}%</b></div>}
            {eff.pacing_index != null && <div>Pacing: <b className={val}>{eff.pacing_index}%</b></div>}
            {eff.dropoff_pct != null && <div>Drop-off: <b className={val}>{eff.dropoff_pct}%</b></div>}
            {eff.hr_recovery_60s != null && <div>HR recovery: <b className={val}>{eff.hr_recovery_60s} bpm</b></div>}
            {eff.peak_torque != null && <div>Peak torque: <b className={val}>{eff.peak_torque} Nm</b></div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// Lists every persisted template run for this activity as its own card, with deltas vs
// the previous run of the same template on another activity (issue #66). Choosing a
// template only happens when adding a run, so what is displayed always matches a real run.
export default function TemplateRunsSection({ activityId, onVisibleWindowsChange }) {
  const [templates, setTemplates] = useState([])
  const [runs, setRuns] = useState([])
  const [historyBySlug, setHistoryBySlug] = useState({})
  const [hiddenIds, setHiddenIds] = useState(() => new Set())
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  const [tab, setTab] = useState('runs')
  const [compareMetric, setCompareMetric] = useState('')
  const [compareTemplateId, setCompareTemplateId] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [pickedTemplateId, setPickedTemplateId] = useState('')
  const [showOnChart, setShowOnChart] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)

  const loadTemplates = useCallback(async () => {
    const authHeader = await getAuthHeader()
    const res = await fetch('/api/templates', { headers: authHeader })
    const data = await res.json()
    if (res.ok) setTemplates(data.templates || [])
  }, [])

  const loadHistory = useCallback(async (slug) => {
    const authHeader = await getAuthHeader()
    const res = await fetch(`/api/templates/${slug}/history`, { headers: authHeader })
    const data = await res.json()
    if (res.ok) setHistoryBySlug((prev) => ({ ...prev, [slug]: data.executions || [] }))
  }, [])

  const loadRuns = useCallback(async () => {
    if (!activityId) return
    const authHeader = await getAuthHeader()
    const res = await fetch(`/api/activities/${activityId}/apply-template`, { headers: authHeader })
    const data = await res.json()
    if (res.ok) {
      const list = data.executions || []
      setRuns(list)
      list.forEach((r) => r.analysis_templates?.slug && loadHistory(r.analysis_templates.slug))
    }
  }, [activityId, loadHistory])

  useEffect(() => {
    loadTemplates()
    loadRuns()
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id || null))
  }, [loadTemplates, loadRuns])

  // Stable colour per run, in the order runs were first created.
  const colorById = useMemo(() => {
    const ordered = [...runs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    return Object.fromEntries(ordered.map((r, i) => [r.id, RUN_COLORS[i % RUN_COLORS.length]]))
  }, [runs])

  useEffect(() => {
    const windows = runs
      .filter((r) => !hiddenIds.has(r.id) && Array.isArray(r.efforts))
      .flatMap((r) =>
        r.efforts
          .filter((e) => e.start_sec != null && e.end_sec != null)
          .map((e) => ({ start_sec: e.start_sec, end_sec: e.end_sec, role: e.role || 'work', color: colorById[r.id] }))
      )
    onVisibleWindowsChange?.(windows)
  }, [runs, hiddenIds, colorById, onVisibleWindowsChange])

  const toggleIn = (setter, id) =>
    setter((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const previousRunFor = (run) => {
    const history = historyBySlug[run.analysis_templates?.slug] || []
    return history.find((h) => h.activity_id !== activityId && new Date(h.created_at) <= new Date(run.updated_at))
  }

  const runTemplate = async (templateId, { hide = false } = {}) => {
    setRunning(true)
    setError(null)
    try {
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/activities/${activityId}/apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ templateId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Template evaluation failed')
      if (hide) setHiddenIds((prev) => new Set(prev).add(data.execution.id))
      else setHiddenIds((prev) => { const n = new Set(prev); n.delete(data.execution.id); return n })
      await loadRuns()
      setAddOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  const deleteRun = async (run) => {
    if (!window.confirm(`Delete this "${run.analysis_templates?.name}" run? This cannot be undone.`)) return
    try {
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/activities/${activityId}/apply-template?executionId=${run.id}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete run')
      setRuns((prev) => prev.filter((r) => r.id !== run.id))
    } catch (err) {
      setError(err.message)
    }
  }

  const pickedTemplate = templates.find((t) => t.id === pickedTemplateId) || null
  const ownsPicked = !!(pickedTemplate && currentUserId && pickedTemplate.user_id === currentUserId)

  const deleteTemplate = async (template) => {
    if (!window.confirm(`Delete template "${template.name}"? This cannot be undone.`)) return
    try {
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/templates/${template.slug}`, { method: 'DELETE', headers: authHeader })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete template')
      setPickedTemplateId('')
      loadTemplates()
    } catch (err) {
      setError(err.message)
    }
  }

  const compareTemplate = templates.find((t) => t.id === compareTemplateId) || null
  useEffect(() => {
    if (tab === 'compare' && compareTemplate?.slug && !historyBySlug[compareTemplate.slug]) {
      loadHistory(compareTemplate.slug)
    }
  }, [tab, compareTemplate, historyBySlug, loadHistory])

  const openAdd = () => {
    setPickedTemplateId((prev) => prev || templates[0]?.id || '')
    setAddOpen(true)
  }

  const runTemplateIds = new Set(runs.map((r) => r.template_id))
  const btn = 'py-2 px-3 rounded-xl font-black text-[11px] uppercase tracking-wider transition whitespace-nowrap'

  return (
    <div className="bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
          <span>🧪</span> Template Runs <span className="text-slate-400">({runs.length})</span>
        </h3>
        <button type="button" onClick={openAdd} className={`${btn} bg-orange-500 hover:bg-orange-600 text-white`}>
          + Add Run
        </button>
      </div>

      <div className="flex gap-2 text-[11px] font-black uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 pb-2">
        {[['runs', 'All runs'], ['compare', 'Compare']].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-1 rounded-lg ${tab === key ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-400'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-[11px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl p-2.5">
          {error}
        </div>
      )}

      {tab === 'runs' && (
        <div className="space-y-3">
          {runs.length === 0 && (
            <p className="text-[11px] text-slate-400">
              No runs yet. Add a run to detect target efforts and compute apples-to-apples metrics for this activity.
            </p>
          )}
          {runs.map((run) => {
            const prev = previousRunFor(run)
            const expanded = expandedIds.has(run.id)
            const entries = Object.entries(run.summary || {}).slice(0, 4)
            const hasEfforts = Array.isArray(run.efforts) && run.efforts.length > 0
            return (
              <div key={run.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: colorById[run.id] }} />
                    <b className="text-xs text-slate-900 dark:text-white truncate">
                      {run.analysis_templates?.name || 'Template'}
                    </b>
                    <span className="text-[10px] text-slate-400">
                      run {new Date(run.updated_at).toLocaleString('cs-CZ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-wider">
                    <label className="flex items-center gap-1 text-slate-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!hiddenIds.has(run.id)}
                        onChange={() => toggleIn(setHiddenIds, run.id)}
                      />
                      On chart
                    </label>
                    <button type="button" disabled={running} onClick={() => runTemplate(run.template_id, { hide: hiddenIds.has(run.id) })} className="text-slate-400 hover:text-orange-500 disabled:opacity-50">
                      Re-run
                    </button>
                    <button type="button" onClick={() => deleteRun(run)} className="text-red-500">
                      Delete
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {entries.length === 0 && <span className="text-[11px] text-slate-400">No matching efforts found.</span>}
                  {entries.map(([key, value]) => (
                    <div key={key} className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-center">
                      <div className="text-[8px] uppercase font-bold text-slate-400">{key.replace(/_/g, ' ')}</div>
                      <div className="text-xs font-black text-orange-500">
                        {formatMetric(value)}
                        <DeltaBadge current={value} previous={prev?.summary?.[key]} />
                      </div>
                    </div>
                  ))}
                </div>

                {prev && (
                  <div className="text-[10px] text-slate-400">
                    Δ vs previous run of this template ({prev.activities?.title || 'Session'}, {formatDate(prev.activities?.activity_date)})
                  </div>
                )}

                {hasEfforts && (
                  <button type="button" onClick={() => toggleIn(setExpandedIds, run.id)} className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    {expanded ? '▴ Hide efforts' : `▾ Show efforts (${run.efforts.length})`}
                  </button>
                )}
                {expanded && hasEfforts && <EffortCards efforts={run.efforts} />}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'compare' && (
        <div className="space-y-3">
          <select
            value={compareTemplateId}
            onChange={(e) => setCompareTemplateId(e.target.value)}
            className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 text-xs text-slate-900 dark:text-white font-semibold"
          >
            <option value="">Select a template…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {compareTemplate && (() => {
            const rows = historyBySlug[compareTemplate.slug] || []
            const keys = [...new Set(rows.flatMap((r) => Object.keys(r.summary || {})))].slice(0, 5)
            if (rows.length === 0) return <p className="text-[11px] text-slate-400">No runs of this template yet.</p>
            const metric = keys.includes(compareMetric) ? compareMetric : keys[0]
            const chartData = [...rows].reverse().map((r) => ({
              label: formatDate(r.activities?.activity_date) || '—',
              value: typeof r.summary?.[metric] === 'number' ? Math.round(r.summary[metric] * 10) / 10 : null,
              current: r.activity_id === activityId,
            }))
            return (
              <div className="overflow-x-auto space-y-3">
                {metric && (
                  <div className="space-y-1">
                    <select
                      value={metric}
                      onChange={(e) => setCompareMetric(e.target.value)}
                      className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1.5 text-[11px] text-slate-900 dark:text-white font-semibold"
                    >
                      {keys.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
                    </select>
                    <div className="h-28">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                          <YAxis width={36} tick={{ fontSize: 9 }} domain={['auto', 'auto']} />
                          <Tooltip />
                          <Bar dataKey="value" name={metric.replace(/_/g, ' ')} radius={[4, 4, 0, 0]}>
                            {chartData.map((d, i) => <Cell key={i} fill={d.current ? '#f97316' : '#94a3b8'} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                <table className="w-full text-[11px]">
                  <thead className="text-slate-400 text-left uppercase text-[9px]">
                    <tr>
                      <th className="py-2 pr-3">Activity</th><th className="pr-3">Date</th>
                      {keys.map((k) => <th key={k} className="pr-3">{k.replace(/_/g, ' ')}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.map((r) => (
                      <tr key={r.id} className={r.activity_id === activityId ? 'bg-orange-500/10 font-bold' : ''}>
                        <td className="py-2 pr-3">{r.activity_id === activityId ? '● This activity' : r.activities?.title || 'Session'}</td>
                        <td className="pr-3">{formatDate(r.activities?.activity_date)}</td>
                        {keys.map((k) => <td key={k} className="pr-3 font-mono">{formatMetric(r.summary?.[k])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      )}

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAddOpen(false)}>
          <div className="w-full max-w-md bg-white dark:bg-surface-darkCard rounded-3xl p-6 space-y-4 border border-slate-200 dark:border-surface-darkBorder" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">Add template run</h3>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPickedTemplateId(t.id)}
                  className={`w-full text-left p-3 rounded-xl border ${pickedTemplateId === t.id ? 'border-orange-500' : 'border-slate-200 dark:border-slate-800'}`}
                >
                  <div className="text-xs font-black text-slate-900 dark:text-white">{t.name}{t.user_id ? ' (mine)' : ''}</div>
                  {runTemplateIds.has(t.id) && <div className="text-[10px] text-slate-400">Already run on this activity — re-running replaces it</div>}
                  {t.description && <div className="text-[10px] text-slate-400">{t.description}</div>}
                </button>
              ))}
            </div>
            {ownsPicked && (
              <div className="flex gap-3 text-[10px] font-black uppercase tracking-wider">
                <button type="button" className="text-orange-500" onClick={() => { setEditingTemplate(pickedTemplate); setCreatorOpen(true) }}>Edit template</button>
                <button type="button" className="text-red-500" onClick={() => deleteTemplate(pickedTemplate)}>Delete template</button>
              </div>
            )}
            <label className="flex items-center gap-2 text-[11px] text-slate-500">
              <input type="checkbox" checked={showOnChart} onChange={(e) => setShowOnChart(e.target.checked)} /> Show on chart after run
            </label>
            <div className="flex items-center justify-between">
              <button type="button" className="text-[10px] font-black uppercase tracking-wider text-slate-400" onClick={() => { setEditingTemplate(null); setCreatorOpen(true) }}>
                + Create new template
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setAddOpen(false)} className={`${btn} bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200`}>Cancel</button>
                <button type="button" disabled={running || !pickedTemplateId} onClick={() => runTemplate(pickedTemplateId, { hide: !showOnChart })} className={`${btn} bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50`}>
                  {running ? 'Running…' : 'Run'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <TemplateCreatorModal
        isOpen={creatorOpen}
        editingTemplate={editingTemplate}
        onClose={() => { setCreatorOpen(false); setEditingTemplate(null) }}
        onSaved={(saved) => {
          setEditingTemplate(null)
          loadTemplates()
          if (saved?.id) setPickedTemplateId(saved.id)
        }}
      />
    </div>
  )
}
