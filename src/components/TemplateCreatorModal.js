'use client'

// Template Creator modal (issue #14): author a user-defined "custom_intervals"
// analysis template from a plain-text interval DSL (src/lib/intervalDsl.js),
// preview the parsed structure client-side, and save it via the templates API.
// Also used to edit an existing template the current user owns.

import { useEffect, useMemo, useState } from 'react'
import { getAuthHeader } from '../lib/supabase'
import { parseIntervalDsl } from '../lib/intervalDsl'

const CATEGORIES = ['road', 'track', 'gym']

const DSL_EXAMPLES = [
  {
    title: 'Repeated VO2max intervals (%FTP-banded)',
    dsl: '4x\nwork 3min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP',
  },
  {
    title: 'Decisive climb / final sprint (one-shot, no FTP needed)',
    dsl: '1x\nwork 5min ±40% @ best',
  },
  {
    title: 'Threshold block (%FTP band)',
    dsl: '1x\nwork 20min ±15% @ 95-105%FTP',
  },
  {
    title: 'Absolute watts (no FTP set)',
    dsl: '5x\nwork 30sec ±20% @ 250-300W\nrecovery 90sec ±50% @ <150W',
  },
]

function formatBandLabel(step) {
  if (step.bandType === 'best') return 'best effort'
  const suffix = step.bandType === 'watts' ? 'W' : '% FTP'
  if (step.powerMin != null && step.powerMax != null) return `${step.powerMin}-${step.powerMax}${suffix}`
  if (step.powerMax != null) return `<${step.powerMax}${suffix}`
  if (step.powerMin != null) return `>${step.powerMin}${suffix}`
  return suffix
}

function formatDurationLabel(sec) {
  if (sec % 60 === 0 && sec >= 60) return `${sec / 60}:00`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${sec}s`
}

export default function TemplateCreatorModal({ isOpen, onClose, onSaved, editingTemplate = null }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('road')
  const [visibility, setVisibility] = useState('private')
  const [dslSource, setDslSource] = useState('4x\nwork 3min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP')
  const [showGuide, setShowGuide] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  useEffect(() => {
    if (editingTemplate) {
      setName(editingTemplate.name || '')
      setDescription(editingTemplate.description || '')
      setCategory(editingTemplate.category || 'road')
      setVisibility(editingTemplate.visibility || 'private')
      setDslSource(editingTemplate.dsl_source || '')
    }
  }, [editingTemplate])

  const parsed = useMemo(() => parseIntervalDsl(dslSource), [dslSource])

  if (!isOpen) return null

  const handleSave = async () => {
    setSaveError(null)

    if (!name.trim()) {
      setSaveError('Please give the template a name.')
      return
    }
    if (parsed.errors.length) {
      setSaveError('Fix the DSL errors below before saving.')
      return
    }

    setSaving(true)
    try {
      const authHeader = await getAuthHeader()
      const url = editingTemplate ? `/api/templates/${editingTemplate.slug}` : '/api/templates'
      const method = editingTemplate ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ name, description, category, visibility, dslSource }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save template')

      onSaved?.(data.template)
      onClose?.()
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-surface-darkCard rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
            <span>✏️</span> {editingTemplate ? 'Edit Template' : 'Create Template'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs font-bold"
          >
            ✕ Close
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 3x10min Threshold"
              className="mt-1 w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this template is for"
              className="mt-1 w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-orange-500"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Visibility</label>
            <div className="mt-1 flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900/60 rounded-xl border border-slate-200/60 dark:border-slate-800">
              {['private', 'public'].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  className={`flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold capitalize transition ${
                    visibility === v
                      ? 'bg-orange-500 text-white shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Interval DSL</label>
          <textarea
            value={dslSource}
            onChange={(e) => setDslSource(e.target.value)}
            rows={6}
            spellCheck={false}
            className="mt-1 w-full font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Parse & Preview readout */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-3 space-y-2">
          <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Preview</div>
          {parsed.errors.length > 0 ? (
            <div className="space-y-1">
              {parsed.errors.map((e, idx) => (
                <div
                  key={idx}
                  className="text-[11px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-2"
                >
                  Line {e.line}: {e.message}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {parsed.repeatCount} × [
              {parsed.steps
                .map(
                  (s) =>
                    `${s.role === 'work' ? 'Work' : 'Recovery'} ${formatDurationLabel(s.targetDurationSec)} ±${
                      s.durationTolerancePct
                    }% @ ${formatBandLabel(s)}`
                )
                .join(' → ')}
              ]
            </p>
          )}
        </div>

        {saveError && (
          <div className="text-[11px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl p-2.5">
            {saveError}
          </div>
        )}

        <div className="border-t border-slate-100 dark:border-slate-800/60 pt-3">
          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="text-[11px] font-black uppercase tracking-wider text-orange-500"
          >
            {showGuide ? '▾' : '▸'} DSL Syntax Guide
          </button>

          {showGuide && (
            <div className="mt-2 space-y-3 text-[11px] text-slate-500 dark:text-slate-400">
              <p>
                Line 1 is a repeat count (e.g. <code>4x</code>, or <code>1x</code> for a one-shot pattern). Each
                following line is a step: <code>work|recovery &lt;value&gt;min|sec ±&lt;tolerance&gt;% @ &lt;band&gt;</code>.
                A band is a %FTP range/bound (<code>90-110%FTP</code>, <code>&lt;55%FTP</code>, <code>&gt;80%FTP</code>),
                an absolute watts range/bound (same syntax with <code>W</code>), or <code>best</code>/<code>max</code> to
                locate the single highest-average-power window of that duration with no threshold at all.
              </p>
              <div className="space-y-2">
                {DSL_EXAMPLES.map((ex) => (
                  <div key={ex.title} className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-2.5">
                    <div className="font-bold text-slate-700 dark:text-slate-200 mb-1">{ex.title}</div>
                    <pre className="whitespace-pre-wrap font-mono text-[10px]">{ex.dsl}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-4 rounded-xl bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 font-black text-[11px] uppercase tracking-wider"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="py-2 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-[11px] uppercase tracking-wider transition disabled:opacity-50"
          >
            {saving ? 'Saving…' : editingTemplate ? 'Save Changes' : 'Save Template'}
          </button>
        </div>
      </div>
    </div>
  )
}
