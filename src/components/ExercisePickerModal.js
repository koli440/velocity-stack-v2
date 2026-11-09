'use client'

// Searchable multi-select picker for the gym exercise catalogue (looks and behaves like TemplatePickerModal).
// Search covers names and aliases (accent-insensitive); recent / frequent exercises come first. Riders can suggest a
// missing exercise: it is usable at once as a private exercise and goes to the admin for approval.

import { useEffect, useMemo, useRef, useState } from 'react'
import Portal from './Portal'
import {
  fetchCatalogue, fetchExerciseUsage, findExistingExercise, groupByCategory, MOVEMENT_LABELS, MOVEMENT_TYPES,
  parseAliases, privateLabel, recentExercises, searchExercises, suggestExercise,
} from '../lib/exerciseCatalogue'

const btn = 'py-2 px-3 rounded-xl font-black text-[11px] uppercase tracking-wider transition whitespace-nowrap'
const heading = 'text-[10px] font-black uppercase tracking-wider text-slate-400'
const field = 'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 text-xs text-slate-900 dark:text-white font-semibold'

function Row({ ex, active, checked, onToggle, onActive }) {
  const pending = privateLabel(ex)
  const detail = [ex.category, ex.unilateral ? 'one side at a time' : null, ex.movement_type === 'jump' ? 'height in cm' : null].filter(Boolean).join(' · ')
  return (
    <div
      role="option"
      aria-selected={checked}
      data-exercise-id={ex.id}
      onClick={() => onToggle(ex)}
      onMouseEnter={onActive}
      className={`flex items-center gap-3 px-2 py-2 rounded-xl border cursor-pointer ${active ? 'border-orange-500 bg-orange-500/5' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-900/60'}`}
    >
      <input type="checkbox" tabIndex={-1} className="h-4 w-4" aria-label={`Add ${ex.name}`} checked={checked} onClick={(e) => e.stopPropagation()} onChange={() => onToggle(ex)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-black text-slate-900 dark:text-white">{ex.name}</span>
          {pending && <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-500">{pending}</span>}
        </div>
        {detail && <div className="text-[10px] text-slate-400 truncate">{detail}</div>}
      </div>
    </div>
  )
}

function SuggestForm({ catalogue, initialName, client, onCreated, onUseExisting }) {
  const [name, setName] = useState(initialName)
  const [aliases, setAliases] = useState('')
  const [movementType, setMovementType] = useState('strength')
  const [unilateral, setUnilateral] = useState(false)
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dup = useMemo(() => (name.trim() ? findExistingExercise(catalogue, name, parseAliases(aliases)) : null), [catalogue, name, aliases])

  const submit = async () => {
    if (!name.trim() || dup) return
    setBusy(true)
    setError('')
    const { data, error: err } = await suggestExercise(client, { name, aliases: parseAliases(aliases), movementType, unilateral, category: category.trim() || null })
    setBusy(false)
    if (err) return setError(err.message)
    if (data.status === 'exists') return onUseExisting(data.exercise)
    onCreated(data.exercise, data.suggested)
  }

  return (
    <div className="rounded-2xl border border-orange-500/40 p-3 space-y-2" data-testid="exercise-suggest-form">
      <div className={heading}>Suggest a new exercise</div>
      <p className="text-[10px] text-slate-400">You can use it right away; it stays private to you (and your coach) until the admin approves it.</p>
      <input className={field} value={name} maxLength={120} placeholder="Exercise name" aria-label="New exercise name" onChange={(e) => setName(e.target.value)} />
      <input className={field} value={aliases} placeholder="Other names, separated by commas (optional)" aria-label="Other names" onChange={(e) => setAliases(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <select className={field} value={movementType} aria-label="Movement type" onChange={(e) => setMovementType(e.target.value)}>
          {MOVEMENT_TYPES.map((m) => <option key={m} value={m}>{MOVEMENT_LABELS[m]}{m === 'jump' ? ' (height in cm)' : ''}</option>)}
        </select>
        <input className={field} value={category} maxLength={60} placeholder="Category (optional)" aria-label="Category" onChange={(e) => setCategory(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-[11px] text-slate-500">
        <input type="checkbox" checked={unilateral} onChange={(e) => setUnilateral(e.target.checked)} /> One side at a time (reps counted for both sides in total, e.g. lunges)
      </label>
      {dup && (
        <div className="text-[11px] text-amber-600" role="alert">
          “{dup.name}” already exists.{' '}
          <button type="button" className="underline font-black" onClick={() => onUseExisting(dup)}>Use it</button>
        </div>
      )}
      {error && <div className="text-[11px] font-bold text-red-600" role="alert">{error}</div>}
      <button type="button" disabled={busy || !name.trim() || !!dup} onClick={submit} className={`${btn} bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50`}>
        {busy ? 'Saving…' : 'Use & suggest to admin'}
      </button>
    </div>
  )
}

/**
 * @param {object} p
 * @param {object} p.client Supabase client
 * @param {string} p.ownerId rider whose history ranks the list (own-account queries are owner scoped)
 * @param {boolean} [p.canSuggest] false in coach / athlete context
 * @param {boolean} [p.single] pick exactly one (e.g. "Change exercise")
 * @param {(exercises: object[]) => void} p.onConfirm
 */
export default function ExercisePickerModal({ client, ownerId, canSuggest = true, single = false, title = single ? 'Choose exercise' : 'Add exercises', onConfirm, onClose }) {
  const [catalogue, setCatalogue] = useState([])
  const [usage, setUsage] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  const [notice, setNotice] = useState('')
  const searchRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [cat, use] = await Promise.all([fetchCatalogue(client, ownerId), ownerId ? fetchExerciseUsage(client, ownerId) : new Map()])
        if (cancelled) return
        if (cat.error) setLoadError(cat.error.message || 'Could not load exercises')
        setCatalogue(cat.data)
        setUsage(use)
      } catch (e) {
        if (!cancelled) setLoadError(e.message || 'Could not load exercises')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [client, ownerId])

  useEffect(() => { searchRef.current?.focus() }, [])

  const searching = query.trim().length > 0
  const matches = useMemo(() => searchExercises(catalogue, query, { usage }), [catalogue, query, usage])
  const recents = useMemo(() => (searching ? [] : recentExercises(catalogue, usage)), [catalogue, usage, searching])
  const groups = useMemo(() => groupByCategory(searching ? [] : [...matches].sort((a, b) => String(a.name).localeCompare(String(b.name)))), [matches, searching])
  // Keyboard order = what is visible, top to bottom.
  const order = useMemo(() => (searching ? matches : [...recents, ...groups.flatMap((g) => g.items)]), [searching, matches, recents, groups])
  const activeIdx = Math.max(0, order.findIndex((e) => e.id === activeId))
  const active = order[activeIdx]
  const isChecked = (ex) => checked.some((c) => c.id === ex.id)

  const toggle = (ex) => {
    setNotice('')
    if (single) return onConfirm([ex])
    setChecked((prev) => (prev.some((c) => c.id === ex.id) ? prev.filter((c) => c.id !== ex.id) : [...prev, ex]))
  }
  const confirm = () => {
    const picked = checked.length ? checked : active ? [active] : []
    if (picked.length) onConfirm(picked)
  }

  const move = (d) => {
    if (!order.length) return
    const next = order[(activeIdx + d + order.length) % order.length]
    setActiveId(next.id)
    listRef.current?.querySelector(`[data-exercise-id="${next.id}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter' && e.target?.tagName !== 'BUTTON' && e.target?.tagName !== 'SELECT' && !suggesting) {
      e.preventDefault()
      if (e.shiftKey || single || checked.length) confirm()
      else if (active) toggle(active)
    }
  }

  const useExisting = (ex) => {
    setSuggesting(false)
    setCatalogue((prev) => (prev.some((c) => c.id === ex.id) ? prev : [...prev, ex]))
    setNotice(`“${ex.name}” already exists: selected it for you.`)
    if (single) return onConfirm([ex])
    setChecked((prev) => (prev.some((c) => c.id === ex.id) ? prev : [...prev, ex]))
  }
  const created = (ex, suggested) => {
    setSuggesting(false)
    setCatalogue((prev) => [...prev, ex])
    setNotice(suggested ? `“${ex.name}” sent to the admin for approval. You can use it now.` : `“${ex.name}” saved privately (too many suggestions right now, it was not sent to the admin).`)
    if (single) return onConfirm([ex])
    setChecked((prev) => [...prev, ex])
  }

  const rowProps = (ex) => ({ ex, active: ex.id === active?.id, checked: isChecked(ex), onToggle: toggle, onActive: () => setActiveId(ex.id) })

  return (
    <Portal lockScroll>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose} onKeyDown={onKeyDown}>
        <div
          role="dialog"
          aria-label={title}
          className="w-full max-w-2xl h-[88dvh] sm:h-[80dvh] flex flex-col bg-white dark:bg-surface-darkCard rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-surface-darkBorder"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 sm:p-5 pb-3 space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">{title}</h3>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search exercises by name or other names (e.g. “legpress”)…"
              aria-label="Search exercises"
              className={field}
            />
            {notice && <div className="text-[11px] font-bold text-emerald-600" role="status">{notice}</div>}
          </div>

          <div ref={listRef} role="listbox" aria-multiselectable={!single} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4 border-y border-slate-100 dark:border-slate-800">
            {loading && <p className="text-[11px] text-slate-400 p-2">Loading exercises…</p>}
            {loadError && <p className="text-[11px] text-red-600 p-2" role="alert">{loadError}</p>}
            {!loading && matches.length === 0 && !suggesting && (
              <div className="p-2 space-y-2">
                <p className="text-[11px] text-slate-400">No exercises match “{query}”.</p>
                {canSuggest && <button type="button" className={`${btn} bg-orange-500 text-white`} onClick={() => setSuggesting(true)}>Suggest “{query.trim() || 'a new exercise'}”</button>}
              </div>
            )}
            {recents.length > 0 && (
              <div className="space-y-1">
                <div className={heading}>Recent</div>
                {recents.map((ex) => <Row key={`r-${ex.id}`} {...rowProps(ex)} />)}
              </div>
            )}
            {searching
              ? matches.length > 0 && <div className="space-y-1">{matches.map((ex) => <Row key={ex.id} {...rowProps(ex)} />)}</div>
              : groups.map((g) => (
                <div key={g.category} className="space-y-1">
                  <div className={heading}>{g.category} <span className="font-semibold">({g.items.length})</span></div>
                  {g.items.map((ex) => <Row key={ex.id} {...rowProps(ex)} />)}
                </div>
              ))}
            {suggesting && canSuggest && (
              <SuggestForm catalogue={catalogue} initialName={query.trim()} client={client} onCreated={created} onUseExisting={useExisting} />
            )}
          </div>

          <div className="p-3 sm:p-4 flex items-center justify-between gap-3 flex-wrap">
            {canSuggest && !suggesting ? (
              <button type="button" className="text-[10px] font-black uppercase tracking-wider text-slate-400" onClick={() => setSuggesting(true)}>
                + Suggest a new exercise
              </button>
            ) : <span />}
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClose} className={`${btn} bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200`}>Cancel</button>
              {!single && (
                <button type="button" disabled={!checked.length && !active} onClick={confirm} className={`${btn} bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50`}>
                  {checked.length > 1 ? `Add ${checked.length} exercises` : 'Add exercise'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}
