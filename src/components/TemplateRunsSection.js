'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import TemplatePickerModal from './TemplatePickerModal'
import { selectedSummaryKeys, DEFAULT_RUN_KEYS, LEGACY_STATIC_KEYS } from '../lib/summaryMetrics'
import { formatDate, formatDateTime } from '../lib/dateFormat'
import { getAuthHeader, supabase } from '../lib/supabase'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import TemplateRunAnalysis from './TemplateRunAnalysis'
import { analyzeRun, headlineValue, selectReference, ridden } from '../lib/templateComparison'
import { loadReferencePref, normalizePref, saveReferencePref } from '../lib/templateReferencePrefs'
import TemplateCreatorModal from './TemplateCreatorModal'
import Icon from './Icon'
import AddPbModal from './AddPbModal'
import { fetchDisciplines } from '../lib/lookups'
import { buildPbPrefillFromEffort } from '../lib/pbVault'
import { CoachRunBadge, useRunCoachNames } from './CoachBadge'
import { canSendRunToPbVault, coachRunnableTemplates, compareOptions, filterRuns, runActions, runTemplateName, runTemplateSlug } from '../lib/coachRuns'
import { EFFORT_RESULT_KEYS, formatRaceTime, formatResultValue, isLowerBetterKey } from '../lib/effortMetrics'

const RUN_COLORS = ['#f59e0b', '#38bdf8', '#d946ef', '#34d399', '#f87171', '#a78bfa']

function formatMetric(value, suffix = '', key = null) {
  if (value === null || value === undefined) return '—'
  if (key && typeof value === 'number' && (EFFORT_RESULT_KEYS.includes(key) || isLowerBetterKey(key))) return formatResultValue(key, value)
  if (typeof value === 'number') return `${Math.round(value * 10) / 10}${suffix}`
  return `${value}${suffix}`
}

function EffortCards({ efforts, onSendToPbVault }) {
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
            ({eff.target_distance_m != null ? `${eff.target_distance_m}m` : eff.distance_m != null && eff.keyed_by === undefined ? `${eff.distance_m}m` : `${eff.duration_sec}s`})
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-400">
            {eff.elapsed_time_sec != null && (
              <div className="col-span-2 text-xs">Time: <b className="text-orange-500">{formatRaceTime(eff.elapsed_time_sec, 2)}</b></div>
            )}
            {eff.keyed_by === 'time' && eff.distance_m != null && (
              <div className="col-span-2 text-xs">Distance: <b className="text-orange-500">{(eff.distance_m / 1000).toFixed(2)} km</b></div>
            )}
            {eff.no_speed_data && <div className="col-span-2 italic">{eff.keyed_by === 'distance' ? 'No speed data: time unavailable' : 'No distance data'}</div>}
            {eff.target_distance_m != null && <div>Target: <b className={val}>{eff.target_distance_m}m</b></div>}
            {eff.avg_power != null && <div>Avg W: <b className={val}>{eff.avg_power}</b></div>}
            {eff.max_power != null && <div>Max W: <b className={val}>{eff.max_power}</b></div>}
            {eff.avg_cadence_rpm != null && <div>Avg cadence: <b className={val}>{eff.avg_cadence_rpm} rpm</b></div>}
            {eff.avg_speed_kmh != null && <div>Avg speed: <b className={val}>{eff.avg_speed_kmh} km/h</b></div>}
            {eff.avg_wkg != null && <div>Avg W/kg: <b className={val}>{eff.avg_wkg}</b></div>}
            {eff.avg_zone != null && <div>Zone: <b className={val}>Z{eff.avg_zone}{eff.target_zone ? ` (target ${eff.target_zone})` : ''}</b></div>}
            {eff.pct_of_ftp != null && <div>% FTP: <b className={val}>{eff.pct_of_ftp}%</b></div>}
            {eff.pacing_index != null && <div>Pacing: <b className={val}>{eff.pacing_index}%</b></div>}
            {eff.dropoff_pct != null && <div>Drop-off: <b className={val}>{eff.dropoff_pct}%</b></div>}
            {Object.keys(eff)
              .filter((k) => /^hr_recovery_\d+s$/.test(k) && eff[k] != null)
              .map((k) => (
                <div key={k}>HR recovery ({k.replace(/\D/g, '')}s): <b className={val}>{eff[k]} bpm</b></div>
              ))}
            {eff.np_w != null && <div>NP: <b className={val}>{eff.np_w} W</b></div>}
            {eff.vi != null && <div>VI: <b className={val}>{eff.vi}</b></div>}
            {eff.intensity_factor != null && <div>IF: <b className={val}>{eff.intensity_factor}</b></div>}
            {eff.avg_hr_bpm != null && <div>Avg HR: <b className={val}>{eff.avg_hr_bpm} bpm</b></div>}
            {Array.isArray(eff.lap_splits_sec) && eff.lap_splits_sec.length > 0 && (
              <div>Lap splits{eff.lap_length_m ? ` (${eff.lap_length_m} m)` : ''}: <b className={val}>{eff.lap_splits_sec.map((t) => formatRaceTime(t, 2)).join(', ')}</b></div>
            )}
            {eff.pw_hr_decoupling_pct != null && <div>Pw:HR decoupling: <b className={val}>{eff.pw_hr_decoupling_pct}%</b></div>}
            {eff.work_kj != null && <div>Work: <b className={val}>{eff.work_kj} kJ</b></div>}
            {eff.peak_torque != null && <div>Peak torque: <b className={val}>{eff.peak_torque} Nm</b></div>}
          </div>
          {onSendToPbVault && (
            <button
              type="button"
              onClick={() => onSendToPbVault(eff)}
              className="mt-1 text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              Send to PB Vault
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// Lists every persisted template run for this activity as its own card, with deltas vs
// the previous run of the same template on another activity (issue #66). Choosing a
// template only happens when adding a run, so what is displayed always matches a real run.
// `riderId` switches on athlete mode: an active coach viewing the athlete's activity. Runs he adds are stored on
// the athlete's account, only his own + system templates are offered, and he can delete/re-run only his own runs.
export default function TemplateRunsSection({ activityId, activity = null, tracks = [], riderId = null, onVisibleWindowsChange }) {
  const athleteMode = !!riderId
  const [runFilter, setRunFilter] = useState('all')
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
  const [checkedIds, setCheckedIds] = useState(() => new Set())
  const [showOnChart, setShowOnChart] = useState(true)
  const [running, setRunning] = useState(false)
  const [pbPrefill, setPbPrefill] = useState(null)
  const [error, setError] = useState(null)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [favoriteIds, setFavoriteIds] = useState(() => new Set())
  const [recentIds, setRecentIds] = useState([])

  const sendToPbVault = async (effort) => {
    const disciplines = await fetchDisciplines(supabase)
    setPbPrefill(buildPbPrefillFromEffort(effort, activity, disciplines))
  }

  const loadTemplates = useCallback(async () => {
    const authHeader = await getAuthHeader()
    const res = await fetch('/api/templates', { headers: authHeader })
    const data = await res.json()
    if (res.ok) setTemplates(data.templates || [])  // athlete mode narrows to coachRunnableTemplates below
  }, [])

  const loadPickerExtras = useCallback(async () => {
    const authHeader = await getAuthHeader()
    const [favRes, recentRes] = await Promise.all([
      fetch('/api/templates/favorites', { headers: authHeader }),
      fetch('/api/templates/recent', { headers: authHeader }),
    ])
    if (favRes.ok) setFavoriteIds(new Set((await favRes.json()).favoriteIds || []))
    if (recentRes.ok) setRecentIds((await recentRes.json()).recentIds || [])
  }, [])

  const toggleFavorite = async (template) => {
    const wasFavorite = favoriteIds.has(template.id)
    const apply = (on) =>
      setFavoriteIds((prev) => {
        const next = new Set(prev)
        on ? next.add(template.id) : next.delete(template.id)
        return next
      })
    apply(!wasFavorite)
    try {
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/templates/${template.slug}/favorite`, {
        method: wasFavorite ? 'DELETE' : 'PUT',
        headers: authHeader,
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to update favorite')
    } catch (err) {
      apply(wasFavorite)
      setError(err.message)
    }
  }

  const loadHistory = useCallback(async (slug) => {
    const authHeader = await getAuthHeader()
    const res = await fetch(`/api/templates/${slug}/history${athleteMode ? `?rider=${riderId}` : ''}`, { headers: authHeader })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Failed to load template history')
      return
    }
    setHistoryBySlug((prev) => ({ ...prev, [slug]: data.executions || [] }))
  }, [athleteMode, riderId])

  const loadRuns = useCallback(async () => {
    if (!activityId) return
    const authHeader = await getAuthHeader()
    const res = await fetch(`/api/activities/${activityId}/apply-template`, { headers: authHeader })
    const data = await res.json()
    if (res.ok) {
      const list = data.executions || []
      setRuns(list)
      list.forEach((r) => runTemplateSlug(r) && loadHistory(runTemplateSlug(r)))
    }
  }, [activityId, loadHistory])

  useEffect(() => {
    setHistoryBySlug({})
  }, [activityId])

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

  const [prefsBySlug, setPrefsBySlug] = useState({})
  const [chartMode, setChartMode] = useState('pct')

  useEffect(() => {
    if (!currentUserId) return
    const slugs = [...new Set(runs.map((r) => runTemplateSlug(r)).filter(Boolean))].filter((slug) => !prefsBySlug[slug])
    slugs.forEach((slug) => {
      loadReferencePref(supabase, { userId: currentUserId, scopeId: athleteMode ? riderId : null, slug }).then((pref) =>
        setPrefsBySlug((prev) => (prev[slug] ? prev : { ...prev, [slug]: pref }))
      )
    })
  }, [runs, currentUserId, athleteMode, riderId, prefsBySlug])

  const changePref = (slug, pref) => {
    const clean = normalizePref(pref)
    setPrefsBySlug((prev) => ({ ...prev, [slug]: clean }))
    saveReferencePref(supabase, { userId: currentUserId, scopeId: athleteMode ? riderId : null, slug, pref: clean })
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
      loadPickerExtras()
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  const toggleChecked = (id) =>
    setCheckedIds((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  // Runs the ticked templates one after another (one request each); failures are reported together.
  const runTemplates = async (ids, { hide = false } = {}) => {
    setRunning(true)
    setError(null)
    const failures = []
    const failedIds = []
    try {
      const authHeader = await getAuthHeader()
      for (const id of ids) {
        try {
          const res = await fetch(`/api/activities/${activityId}/apply-template`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({ templateId: id }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Template evaluation failed')
          setHiddenIds((prev) => {
            const n = new Set(prev)
            hide ? n.add(data.execution.id) : n.delete(data.execution.id)
            return n
          })
        } catch (err) {
          failedIds.push(id)
          failures.push(`${templates.find((t) => t.id === id)?.name || 'Template'}: ${err.message}`)
        }
      }
      await loadRuns()
      loadPickerExtras()
      if (failures.length) setError(failures.join(' · '))
      else setAddOpen(false)
      setCheckedIds(new Set(failedIds))
    } finally {
      setRunning(false)
    }
  }

  const deleteRun = async (run) => {
    if (!window.confirm(`Delete this "${runTemplateName(run)}" run? This cannot be undone.`)) return
    try {
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/activities/${activityId}/apply-template?executionId=${run.id}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete run')
      setRuns((prev) => prev.filter((r) => r.id !== run.id))
      if (runTemplateSlug(run)) loadHistory(runTemplateSlug(run))
    } catch (err) {
      setError(err.message)
    }
  }


  const deleteTemplate = async (template) => {
    if (!window.confirm(`Delete template "${template.name}"? This cannot be undone.`)) return
    try {
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/templates/${template.slug}`, { method: 'DELETE', headers: authHeader })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete template')
      setPickedTemplateId((prev) => (prev === template.id ? '' : prev))
      loadTemplates()
    } catch (err) {
      setError(err.message)
    }
  }

  const compareTemplate = compareOptions(runs).find((o) => o.slug === compareTemplateId) || null
  useEffect(() => {
    if (tab === 'compare' && compareTemplate?.slug && !historyBySlug[compareTemplate.slug]) {
      loadHistory(compareTemplate.slug)
    }
  }, [tab, compareTemplate, historyBySlug, loadHistory])

  const openAdd = () => {
    setPickedTemplateId((prev) => prev || (athleteMode ? coachRunnableTemplates(templates, currentUserId) : templates)[0]?.id || '')
    setCheckedIds(new Set())
    setAddOpen(true)
    loadPickerExtras()
  }

  const runTemplateIds = new Set(runs.map((r) => r.template_id))
  const coachNames = useRunCoachNames(runs)
  const hasCoachRuns = runs.some((r) => r.by_coach)
  const shownRuns = filterRuns(runs, runFilter)
  const btn = 'py-2 px-3 rounded-xl font-black text-[11px] uppercase tracking-wider transition whitespace-nowrap'

  return (
    <div className="glass-dense bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
          <Icon name="flask" /> Template Runs <span className="text-slate-400">({shownRuns.length})</span>
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

      {hasCoachRuns && !athleteMode && (
        <div className="flex gap-2 text-[10px] font-black uppercase tracking-wider" data-testid="run-filter">
          {[['all', 'All'], ['coach', 'By coach'], ['own', 'My runs']].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setRunFilter(key)} className={`px-2 py-1 rounded-lg ${runFilter === key ? 'bg-sky-500/10 text-sky-500' : 'text-slate-400'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

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
          {shownRuns.map((run) => {
            const actions = runActions(run, { userId: currentUserId, athleteContext: athleteMode })
            const slug = runTemplateSlug(run)
            const history = historyBySlug[slug] || []
            const analysis = analyzeRun(run, { manifest: templates.find((t) => t.id === run.template_id)?.manifest })
            const pref = prefsBySlug[slug] || normalizePref(null)
            const current = { id: run.id, activity_id: run.activity_id, date: ridden(run) }
            const reference = analysis.metric ? selectReference(history, current, { mode: pref.mode, customId: pref.customId, metric: analysis.metric }) : null
            const candidates = analysis.metric
              ? history
                  .filter((h) => h.id !== run.id && h.activity_id !== run.activity_id)
                  .map((h) => ({ ...h, __headline: headlineValue(h, analysis.metric) }))
                  .filter((h) => h.__headline != null)
                  .sort((a, b) => ridden(b) - ridden(a))
              : []
            const expanded = expandedIds.has(run.id)
            const summaryEntries = Object.entries(run.summary || {})
            const manifest = templates.find((t) => t.id === run.template_id)?.manifest
            // Without a readable definition (a coach's template) every non-legacy result is shown.
            const metricKeys = manifest ? selectedSummaryKeys(manifest.summary_metrics) : summaryEntries.map(([key]) => key)
            const scalar = ([, value]) => value === null || typeof value !== 'object'
            const entries = [
              ...summaryEntries.slice(0, 4).filter(([key]) => !LEGACY_STATIC_KEYS.includes(key)),
              ...summaryEntries.slice(4).filter(([key]) => !LEGACY_STATIC_KEYS.includes(key) && (metricKeys.includes(key) || DEFAULT_RUN_KEYS.includes(key) || EFFORT_RESULT_KEYS.includes(key))),
            ].filter(scalar)
            const hasEfforts = Array.isArray(run.efforts) && run.efforts.length > 0
            return (
              <div key={run.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: colorById[run.id] }} />
                    <b className="text-xs text-slate-900 dark:text-white truncate">
                      {runTemplateName(run)}
                    </b>
                    <CoachRunBadge run={run} names={coachNames} />
                    <span className="text-[10px] text-slate-400">
                      run {formatDateTime(run.updated_at)}
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
                    {actions.canRerun && (
                      <button type="button" disabled={running} onClick={() => runTemplate(run.template_id, { hide: hiddenIds.has(run.id) })} className="text-slate-400 hover:text-orange-500 disabled:opacity-50">
                        Re-run
                      </button>
                    )}
                    {actions.canDelete && (
                      <button type="button" onClick={() => deleteRun(run)} className="text-red-500">
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {entries.length === 0 && <span className="text-[11px] text-slate-400">No matching efforts found.</span>}
                  {entries.map(([key, value]) => (
                    <div key={key} className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-center">
                      <div className="text-[8px] uppercase font-bold text-slate-400">{key.replace(/_/g, ' ')}</div>
                      <div className="text-xs font-black text-orange-500">
                        {formatMetric(value, '', key)}
                      </div>
                    </div>
                  ))}
                </div>

                {analysis.metric && hasEfforts && (
                  <TemplateRunAnalysis
                    run={run}
                    history={history}
                    reference={reference}
                    analysis={analysis}
                    pref={pref}
                    onPrefChange={(next) => changePref(slug, next)}
                    candidates={candidates}
                    chartMode={chartMode}
                    onChartModeChange={setChartMode}
                  />
                )}

                {hasEfforts && (
                  <button type="button" onClick={() => toggleIn(setExpandedIds, run.id)} className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    {expanded ? '▴ Hide efforts' : `▾ Show efforts (${run.efforts.length})`}
                  </button>
                )}
                {expanded && hasEfforts && <EffortCards efforts={run.efforts} onSendToPbVault={activity && canSendRunToPbVault(run) && !athleteMode ? sendToPbVault : null} />}
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
            {compareOptions(runs).map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
          </select>
          {compareTemplate && (() => {
            const rows = [...(historyBySlug[compareTemplate.slug] || [])].sort(
              (a, b) => new Date(b.activities?.activity_date || b.created_at) - new Date(a.activities?.activity_date || a.created_at)
            )
            const allKeys = [...new Set(rows.flatMap((r) => Object.keys(r.summary || {})))]
            // Time and distance results are always offered (older runs simply have none).
            const keys = [...allKeys.filter((k) => EFFORT_RESULT_KEYS.includes(k)), ...allKeys.filter((k) => !EFFORT_RESULT_KEYS.includes(k))].slice(0, 8)
            if (rows.length === 0) return <p className="text-[11px] text-slate-400">No runs of this template yet.</p>
            const metric = keys.includes(compareMetric) ? compareMetric : keys[0]
            const chartData = [...rows].reverse().map((r) => ({
              label: formatDate(r.activities?.activity_date) || '—',
              value: typeof r.summary?.[metric] === 'number' ? Math.round(r.summary[metric] * 100) / 100 : null,
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
                      {keys.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}{isLowerBetterKey(k) ? ' (lower is better)' : ''}</option>)}
                    </select>
                    <div className="h-28">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                          <YAxis width={36} tick={{ fontSize: 9 }} domain={['auto', 'auto']} tickFormatter={(v) => (EFFORT_RESULT_KEYS.includes(metric) ? formatResultValue(metric, v) : v)} />
                          <Tooltip formatter={(v) => (EFFORT_RESULT_KEYS.includes(metric) ? formatResultValue(metric, v) : v)} />
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
                        {keys.map((k) => <td key={k} className="pr-3 font-mono">{formatMetric(r.summary?.[k], '', k)}</td>)}
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
        <TemplatePickerModal
          templates={athleteMode ? coachRunnableTemplates(templates, currentUserId) : templates}
          userId={currentUserId}
          runTemplateIds={runTemplateIds}
          favoriteIds={favoriteIds}
          recentIds={recentIds}
          selectedId={pickedTemplateId}
          onSelect={setPickedTemplateId}
          showOnChart={showOnChart}
          onShowOnChartChange={setShowOnChart}
          running={running}
          onToggleFavorite={toggleFavorite}
          onRun={(id) => runTemplate(id, { hide: !showOnChart })}
          checkedIds={checkedIds}
          onToggleChecked={toggleChecked}
          onRunMany={(ids) => runTemplates(ids, { hide: !showOnChart })}
          onClose={() => setAddOpen(false)}
          onCreate={() => { setEditingTemplate(null); setCreatorOpen(true) }}
          onEdit={(t) => { setEditingTemplate(t); setCreatorOpen(true) }}
          onDelete={deleteTemplate}
        />
      )}

      <AddPbModal
        isOpen={!!pbPrefill}
        prefill={pbPrefill}
        tracks={tracks}
        onClose={() => setPbPrefill(null)}
        onSaved={() => setPbPrefill(null)}
      />

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
