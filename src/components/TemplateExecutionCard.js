'use client'

import { useEffect, useMemo, useState } from 'react'

function formatMetric(value, suffix = '') {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return `${Math.round(value * 10) / 10}${suffix}`
  return `${value}${suffix}`
}

export default function TemplateExecutionCard({ activityId }) {
  const [templates, setTemplates] = useState([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [running, setRunning] = useState(false)
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [execution, setExecution] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    const loadTemplates = async () => {
      setLoadingTemplates(true)
      try {
        const res = await fetch('/api/templates')
        const data = await res.json()
        if (res.ok) {
          setTemplates(data.templates || [])
          if (data.templates?.length) {
            setSelectedTemplateId((prev) => prev || data.templates[0].id)
          }
        }
      } finally {
        setLoadingTemplates(false)
      }
    }

    const loadLastExecution = async () => {
      if (!activityId) return
      const res = await fetch(`/api/activities/${activityId}/apply-template`)
      const data = await res.json()
      if (res.ok && data.executions?.length) {
        setExecution(data.executions[0])
      }
    }

    loadTemplates()
    loadLastExecution()
  }, [activityId])

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  )

  useEffect(() => {
    const loadHistory = async () => {
      if (!selectedTemplate) {
        setHistory([])
        return
      }
      const res = await fetch(`/api/templates/${selectedTemplate.slug}/history`)
      const data = await res.json()
      if (res.ok) {
        setHistory((data.executions || []).filter((e) => e.activity_id !== activityId))
      }
    }
    loadHistory()
  }, [selectedTemplate, activityId])

  const handleRunTemplate = async () => {
    if (!selectedTemplateId) return
    setRunning(true)
    setError(null)

    try {
      const res = await fetch(`/api/activities/${activityId}/apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: selectedTemplateId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Template evaluation failed')
      setExecution(data.execution)
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
          <span>🧪</span> Analysis Template Evaluation
        </h3>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            disabled={loadingTemplates}
            className="flex-1 sm:flex-none bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-semibold"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleRunTemplate}
            disabled={running || !selectedTemplateId}
            className="py-2 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-[11px] uppercase tracking-wider transition disabled:opacity-50 whitespace-nowrap"
          >
            {running ? 'Running…' : execution ? 'Re-run' : 'Run Template'}
          </button>
        </div>
      </div>

      {selectedTemplate?.description && (
        <p className="text-[11px] text-slate-400">{selectedTemplate.description}</p>
      )}

      {error && (
        <div className="text-[11px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl p-2.5">
          {error}
        </div>
      )}

      {execution && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {Object.entries(execution.summary || {}).map(([key, value]) => (
              <div
                key={key}
                className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-center"
              >
                <div className="text-[8px] uppercase font-bold text-slate-400">{key.replace(/_/g, ' ')}</div>
                <div className="text-xs font-black text-orange-500">{formatMetric(value)}</div>
              </div>
            ))}
          </div>

          {Array.isArray(execution.efforts) && execution.efforts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {execution.efforts.map((eff, idx) => (
                <div
                  key={eff.id || idx}
                  className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-1"
                >
                  <div className="text-xs font-black text-slate-900 dark:text-white">
                    Effort #{idx + 1} ({eff.duration_sec}s)
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-400">
                    {eff.avg_power != null && <div>Avg W: <b className="text-slate-700 dark:text-slate-200">{eff.avg_power}</b></div>}
                    {eff.max_power != null && <div>Max W: <b className="text-slate-700 dark:text-slate-200">{eff.max_power}</b></div>}
                    {eff.pacing_index != null && <div>Pacing: <b className="text-slate-700 dark:text-slate-200">{eff.pacing_index}%</b></div>}
                    {eff.dropoff_pct != null && <div>Drop-off: <b className="text-slate-700 dark:text-slate-200">{eff.dropoff_pct}%</b></div>}
                    {eff.hr_recovery_60s != null && <div>HR recovery: <b className="text-slate-700 dark:text-slate-200">{eff.hr_recovery_60s} bpm</b></div>}
                    {eff.peak_torque != null && <div>Peak torque: <b className="text-slate-700 dark:text-slate-200">{eff.peak_torque} Nm</b></div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!execution && !error && (
        <p className="text-[11px] text-slate-400">
          Run a template to detect target efforts and compute apples-to-apples metrics for this activity.
        </p>
      )}

      {/* Benchmarking panel: compare against prior sessions using the same template */}
      {history.length > 0 && (
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800/60">
          <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
            Prior Sessions — {selectedTemplate?.name}
          </h4>
          <div className="space-y-1.5">
            {history.slice(0, 5).map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800"
              >
                <span className="font-semibold text-slate-500 dark:text-slate-400 truncate">
                  {h.activities?.title || 'Session'} ·{' '}
                  {h.activities?.activity_date
                    ? new Date(h.activities.activity_date).toLocaleDateString('cs-CZ')
                    : ''}
                </span>
                <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                  {Object.entries(h.summary || {})
                    .slice(0, 2)
                    .map(([k, v]) => `${k}: ${formatMetric(v)}`)
                    .join(' · ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
