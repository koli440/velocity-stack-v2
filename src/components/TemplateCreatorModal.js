'use client'

// Template Creator modal (issue #14): author a user-defined "custom_intervals"
// analysis template from a plain-text interval DSL (src/lib/intervalDsl.js),
// preview the parsed structure client-side, and save it via the templates API.
// Also used to edit an existing template the current user owns.

import { useEffect, useMemo, useState } from 'react'
import Portal from './Portal'
import { getAuthHeader } from '../lib/supabase'
import { BAND_SUFFIXES, parseIntervalDsl } from '../lib/intervalDsl'
import { DSL_GUIDE_PATH } from '../lib/dslGuide'
import { formatLegacyOptions } from '../lib/legacyPatterns'
import Icon from './Icon'

const DEFAULT_DSL = '4x\nwork 3min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP'
const CATEGORIES = ['road', 'track', 'gym']

function formatBandLabel(step) {
  if (step.bandType === 'best') return `best ${step.bestMetric || 'power'} effort`
  if (step.bandType === 'zone') {
    if (step.powerMin != null && step.powerMax != null) return step.powerMin === step.powerMax ? `Z${step.powerMin}` : `Z${step.powerMin}-Z${step.powerMax}`
    return step.powerMax != null ? `<Z${step.powerMax}` : `>Z${step.powerMin}`
  }
  const suffix = step.bandType === 'pct_ftp' ? '% FTP' : BAND_SUFFIXES[step.bandType] || '% FTP'
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

function formatDistanceLabel(m) {
  if (m % 1000 === 0 && m >= 1000) return `${m / 1000}km`
  return `${m}m`
}

function formatValueLabel(step) {
  return step.keyBy === 'distance' ? formatDistanceLabel(step.targetDistanceM) : formatDurationLabel(step.targetDurationSec)
}

function TemplateCreatorModalInner({ isOpen, onClose, onSaved, editingTemplate = null }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('road')
  const [visibility, setVisibility] = useState('private')
  const [dslSource, setDslSource] = useState(DEFAULT_DSL)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const originalDsl = editingTemplate ? editingTemplate.dsl_source || '' : DEFAULT_DSL

  // Re-seed the form each time the modal opens so stale edits don't persist.
  useEffect(() => {
    if (!isOpen) return
    if (editingTemplate) {
      setName(editingTemplate.name || '')
      setDescription(editingTemplate.description || '')
      setCategory(editingTemplate.category || 'road')
      setVisibility(editingTemplate.visibility || 'private')
      setDslSource(editingTemplate.dsl_source || '')
    } else {
      setDslSource(DEFAULT_DSL)
    }
    setSaveError(null)
  }, [editingTemplate, isOpen])

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
      <div className="glass-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-surface-darkCard rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
            <Icon name="edit" /> {editingTemplate ? 'Edit Template' : 'Create Template'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs font-bold"
          >
            <Icon name="close" /> Close
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
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Interval DSL</label>
            <button
              type="button"
              onClick={() => setDslSource(originalDsl)}
              disabled={dslSource === originalDsl}
              className="text-[10px] font-black uppercase tracking-wider text-orange-500 disabled:opacity-40"
            >
              Reset to default
            </button>
          </div>
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
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Valid example:
                <pre className="mt-1 font-mono whitespace-pre-wrap">{DEFAULT_DSL}</pre>
              </div>
            </div>
          ) : (
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {parsed.pattern ? (
                <>
                  Pattern {parsed.pattern}
                  {formatLegacyOptions(parsed.pattern, parsed.patternOptions).length > 0 &&
                    ` (${formatLegacyOptions(parsed.pattern, parsed.patternOptions).join(', ')})`}
                  {parsed.metrics?.length > 0 && ` — metrics: ${parsed.metrics.map((m) => m.id).join(', ')}`}
                </>
              ) : (
              <>
              {parsed.setCount ? `${parsed.setCount} sets × ` : ''}
              {parsed.repeatCount} × [
              {parsed.steps
                .map(
                  (s) =>
                    `${s.role === 'work' ? 'Work' : 'Recovery'} ${formatValueLabel(s)} ±${
                      s.durationTolerancePct
                    }% @ ${formatBandLabel(s)}`
                )
                .join(' → ')}
              ]
              {parsed.setRecovery &&
                ` with set recovery ${formatValueLabel(parsed.setRecovery)} ±${parsed.setRecovery.durationTolerancePct}% @ ${formatBandLabel(
                  parsed.setRecovery
                )}`}
              {parsed.lapLengthM > 0 && ` — ${parsed.lapLengthM} m laps`}
              {parsed.metrics?.length > 0 && ` — metrics: ${parsed.metrics.map((m) => m.id).join(', ')}`}
              {(parsed.warmupSec || parsed.cooldownSec) &&
                ` (ignoring ${[
                  parsed.warmupSec ? `first ${formatDurationLabel(parsed.warmupSec)}` : null,
                  parsed.cooldownSec ? `last ${formatDurationLabel(parsed.cooldownSec)}` : null,
                ]
                  .filter(Boolean)
                  .join(' and ')})`}
              </>
              )}
            </p>
          )}
        </div>

        {saveError && (
          <div className="text-[11px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl p-2.5">
            {saveError}
          </div>
        )}

        <div className="border-t border-slate-100 dark:border-slate-800/60 pt-3">
          <p className="text-[10px] text-slate-400 mb-1.5">
            Band hints: 90-110%FTP, 95-105%LT2, 3-3.5W/kg, or a power zone such as Z3, Z2-Z3, &lt;Z2, &gt;Z4.
          </p>
          <a
            href={DSL_GUIDE_PATH}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-black uppercase tracking-wider text-orange-500"
          >
            <Icon name="ruler" /> DSL Syntax Guide ↗
          </a>
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

export default function TemplateCreatorModal(props) {
  return (
    <Portal>
      <TemplateCreatorModalInner {...props} />
    </Portal>
  )
}
