'use client'

import { useEffect, useMemo, useState } from 'react'
import { getAuthHeader, supabase } from '../lib/supabase'
import TemplateCreatorModal from './TemplateCreatorModal'

function formatMetric(value, suffix = '') {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return `${Math.round(value * 10) / 10}${suffix}`
  return `${value}${suffix}`
}

export default function TemplateExecutionCard({ activityId, onLatestExecution }) {
  const [templates, setTemplates] = useState([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [running, setRunning] = useState(false)
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [execution, setExecution] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState(null)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)

  const loadTemplates = async () => {
    setLoadingTemplates(true)
    try {
      const authHeader = await getAuthHeader()
      const res = await fetch('/api/templates', { headers: authHeader })
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

  useEffect(() => {
    const loadLastExecution = async () => {
      if (!activityId) return
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/activities/${activityId}/apply-template`, {
        headers: authHeader,
      })
      const data = await res.json()
      if (res.ok && data.executions?.length) {
        setExecution(data.executions[0])
      }
    }

    const loadCurrentUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setCurrentUserId(user?.id || null)
    }

    loadTemplates()
    loadLastExecution()
    loadCurrentUser()
  }, [activityId])

  useEffect(() => {
    onLatestExecution?.(execution)
  }, [execution, onLatestExecution])

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
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/templates/${selectedTemplate.slug}/history`, {
        headers: authHeader,
      })
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
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/activities/${activityId}/apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
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

  const handleTemplateSaved = (savedTemplate) => {
    setEditingTemplate(null)
    loadTemplates()
    if (savedTemplate?.id) setSelectedTemplateId(savedTemplate.id)
  }

  const handleEditTemplate = (template) => {
    setEditingTemplate(template)
    setCreatorOpen(true)
  }

  const handleDeleteTemplate = async (template) => {
    if (!window.confirm(`Delete template "${template.name}"? This cannot be undone.`)) return
    try {
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/templates/${template.slug}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete template')
      if (selectedTemplateId === template.id) setSelectedTemplateId('')
      loadTemplates()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleDeleteExecution = async () => {
    if (!execution || !selectedTemplateId) return
    if (!window.confirm('Delete this template result for this activity? This cannot be undone.')) return
    try {
      const authHeader = await getAuthHeader()
      const res = await fetch(
        `/api/activities/${activityId}/apply-template?templateId=${selectedTemplateId}`,
        { method: 'DELETE', headers: authHeader }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete result')
      setExecution(null)
    } catch (err) {
      setError(err.message)
    }
  }

  const ownsSelectedTemplate = !!(selectedTemplate && currentUserId && selectedTemplate.user_id === currentUserId)

  return (
    <div className="bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
          <span>🧪</span> Analysis Template Evaluation
        </h3>

        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <select
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            disabled={loadingTemplates}
            className="flex-1 sm:flex-none bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-semibold"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.user_id ? ' (mine)' : ''}
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
          <button
            type="button"
            onClick={() => {
              setEditingTemplate(null)
              setCreatorOpen(true)
            }}
            className="py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 font-black text-[11px] uppercase tracking-wider transition whitespace-nowrap"
          >
            + Create Template
          </button>
        </div>
      </div>

      {selectedTemplate?.description && (
        <p className="text-[11px] text-slate-400">{selectedTemplate.description}</p>
      )}

      {ownsSelectedTemplate && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleEditTemplate(selectedTemplate)}
            className="text-[10px] font-black uppercase tracking-wider text-orange-500"
          >
            Edit Template
          </button>
          <button
            type="button"
            onClick={() => handleDeleteTemplate(selectedTemplate)}
            className="text-[10px] font-black uppercase tracking-wider text-red-500"
          >
            Delete Template
          </button>
        </div>
      )}

      {error && (
        <div className="text-[11px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl p-2.5">
          {error}
        </div>
      )}

      {execution && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
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
            <button
              type="button"
              onClick={handleDeleteExecution}
              className="shrink-0 py-1.5 px-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-500 font-black text-[10px] uppercase tracking-wider transition whitespace-nowrap"
            >
              Delete Result
            </button>
          </div>

          {Array.isArray(execution.efforts) && execution.efforts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {execution.efforts.map((eff, idx) => (
                <div
                  key={eff.id || idx}
                  className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-1"
                >
                  <div className="text-xs font-black text-slate-900 dark:text-white">
                    {eff.role ? `${eff.role === 'work' ? 'Work' : 'Recovery'} rep ${eff.rep || idx + 1}` : `Effort #${idx + 1}`} ({eff.duration_sec}s)
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-400">
                    {eff.avg_power != null && <div>Avg W: <b className="text-slate-700 dark:text-slate-200">{eff.avg_power}</b></div>}
                    {eff.max_power != null && <div>Max W: <b className="text-slate-700 dark:text-slate-200">{eff.max_power}</b></div>}
                    {eff.pct_of_ftp != null && <div>% FTP: <b className="text-slate-700 dark:text-slate-200">{eff.pct_of_ftp}%</b></div>}
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

      <TemplateCreatorModal
        isOpen={creatorOpen}
        editingTemplate={editingTemplate}
        onClose={() => {
          setCreatorOpen(false)
          setEditingTemplate(null)
        }}
        onSaved={handleTemplateSaved}
      />
    </div>
  )
}
