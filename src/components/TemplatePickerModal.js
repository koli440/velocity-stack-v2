'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import Portal from './Portal'
import { selectedSummaryKeys } from '../lib/summaryMetrics'
import { groupByCategory, isSystemTemplate, searchTemplates, templatePermissions } from '../lib/templateMenu'

const btn = 'py-2 px-3 rounded-xl font-black text-[11px] uppercase tracking-wider transition whitespace-nowrap'

function badgeFor(t, userId) {
  if (isSystemTemplate(t)) return ['System', 'bg-slate-500/15 text-slate-500']
  if (userId && t.user_id === userId) return ['Mine', 'bg-orange-500/15 text-orange-500']
  return ['Public', 'bg-sky-500/15 text-sky-500']
}

function Row({ t, userId, selected, checked, onToggleChecked, ran, starred, canFavorite, menuOpen, onSelect, onToggleStar, onToggleMenu, onEdit, onDelete }) {
  const [label, cls] = badgeFor(t, userId)
  const base = templatePermissions(t, userId)
  const perms = { ...base, canEdit: base.canEdit && !!onEdit, canDelete: base.canDelete && !!onDelete }
  return (
    <div
      data-template-id={t.id}
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(t.id)}
      className={`relative flex items-center gap-2 px-2 py-1.5 rounded-xl border cursor-pointer ${selected ? 'border-orange-500 bg-orange-500/5' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-900/60'}`}
    >
      {onToggleChecked && (
        <input
          type="checkbox"
          aria-label={`Run ${t.name}`}
          checked={checked}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleChecked(t.id)}
        />
      )}
      {canFavorite && (
        <button
          type="button"
          aria-label={starred ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={starred}
          onClick={(e) => { e.stopPropagation(); onToggleStar(t) }}
          className={`text-sm leading-none ${starred ? 'text-amber-400' : 'text-slate-300 dark:text-slate-600 hover:text-amber-400'}`}
        >
          <Icon name="star" size="1em" className={starred ? 'fill-current' : ''} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-slate-900 dark:text-white truncate">{t.name}</span>
          <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>{label}</span>
          {ran && <span title="Already run on this activity" className="text-[10px] font-bold text-emerald-500">● Run</span>}
        </div>
        {t.description && <div className="text-[10px] text-slate-400 truncate">{t.description}</div>}
      </div>
      {(perms.canEdit || perms.canDelete) && (
        <div className="relative">
          <button
            type="button"
            aria-label="Template actions"
            onClick={(e) => { e.stopPropagation(); onToggleMenu(t.id) }}
            className="px-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-black"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-28 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-surface-darkCard shadow-lg p-1 text-[10px] font-black uppercase tracking-wider">
              {perms.canEdit && (
                <button type="button" className="w-full text-left px-2 py-1.5 rounded-lg text-orange-500 hover:bg-slate-50 dark:hover:bg-slate-900/60" onClick={(e) => { e.stopPropagation(); onEdit(t) }}>Edit</button>
              )}
              {perms.canDelete && (
                <button type="button" className="w-full text-left px-2 py-1.5 rounded-lg text-red-500 hover:bg-slate-50 dark:hover:bg-slate-900/60" onClick={(e) => { e.stopPropagation(); onDelete(t) }}>Delete</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Preview({ t, userId, ran, showDefinition }) {
  if (!t) return <p className="text-[11px] text-slate-400">Select a template to preview it.</p>
  const [label] = badgeFor(t, userId)
  const owner = isSystemTemplate(t) ? 'System' : userId && t.user_id === userId ? 'You' : 'Community'
  const metrics = selectedSummaryKeys(t.manifest?.summary_metrics)
  const row = 'flex justify-between gap-3 text-[11px]'
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-black text-slate-900 dark:text-white">{t.name}</div>
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">{label}</div>
      </div>
      <p className="text-[11px] text-slate-600 dark:text-slate-300">{t.description || 'No description.'}</p>
      <div className="space-y-1">
        <div className={row}><span className="text-slate-400">Category</span><b className="text-slate-700 dark:text-slate-200">{t.category || 'Uncategorized'}</b></div>
        <div className={row}><span className="text-slate-400">Owner</span><b className="text-slate-700 dark:text-slate-200">{owner}</b></div>
      </div>
      <div>
        <div className="text-[9px] uppercase font-bold text-slate-400 mb-1">Metrics produced</div>
        {metrics.length === 0 ? (
          <span className="text-[11px] text-slate-400">Default metrics</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {metrics.map((k) => (
              <span key={k} className="px-2 py-0.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-[10px] font-bold text-orange-500">{k.replace(/_/g, ' ')}</span>
            ))}
          </div>
        )}
      </div>
      {showDefinition && t.dsl_source && (
        <div>
          <div className="text-[9px] uppercase font-bold text-slate-400 mb-1">Definition</div>
          <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-2 text-[10px] text-slate-700 dark:text-slate-200">{t.dsl_source}</pre>
        </div>
      )}
      {ran && (
        <div className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5">
          Already run on this activity — re-running replaces the existing run.
        </div>
      )}
    </div>
  )
}

export default function TemplatePickerModal({
  templates,
  userId,
  runTemplateIds = new Set(),
  title = 'Add template run',
  showDefinition = false,
  confirmLabel = 'Run',
  busyLabel = 'Running…',
  favoriteIds,
  recentIds,
  selectedId,
  onSelect,
  showOnChart = false,
  onShowOnChartChange = null,
  running,
  onToggleFavorite,
  onRun,
  checkedIds = null,
  onToggleChecked = null,
  onRunMany = null,
  onClose,
  onCreate,
  onEdit,
  onDelete,
}) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [menuId, setMenuId] = useState(null)
  const searchRef = useRef(null)
  const listRef = useRef(null)
  const searching = query.trim() !== ''
  const multi = !!(onToggleChecked && onRunMany)
  const checkedCount = multi ? checkedIds.size : 0
  const runSelected = () => (checkedCount > 0 ? onRunMany([...checkedIds]) : selectedId && onRun(selectedId))

  useEffect(() => { searchRef.current?.focus() }, [])

  const matches = useMemo(() => searchTemplates(templates, { query }), [templates, query])
  const matchIds = useMemo(() => new Set(matches.map((t) => t.id)), [matches])
  const favorites = useMemo(() => (userId ? matches.filter((t) => favoriteIds.has(t.id)) : []), [matches, favoriteIds, userId])
  const recents = useMemo(() => {
    const byId = new Map(templates.map((t) => [t.id, t]))
    return (userId ? recentIds : []).map((id) => byId.get(id)).filter((t) => t && matchIds.has(t.id))
  }, [templates, recentIds, matchIds, userId])
  const groups = useMemo(() => groupByCategory(matches), [matches])

  const sections = [
    { key: 'fav', title: 'Favorites', items: favorites },
    { key: 'recent', title: 'Recently used', items: recents },
  ].filter((s) => s.items.length > 0)

  // Order used for arrow-key navigation: only rows that are actually visible.
  const navIds = useMemo(() => {
    const ids = [...favorites, ...recents].map((t) => t.id)
    for (const g of groups) if (searching || !collapsed.has(g.category)) ids.push(...g.items.map((t) => t.id))
    return [...new Set(ids)]
  }, [favorites, recents, groups, collapsed, searching])

  // Keep the selection on something visible as the query changes.
  useEffect(() => {
    if (navIds.length && !navIds.includes(selectedId)) onSelect(navIds[0])
  }, [navIds, selectedId, onSelect])

  useEffect(() => {
    listRef.current?.querySelector(`[data-template-id="${selectedId}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId])

  const move = (delta) => {
    if (!navIds.length) return
    const i = navIds.indexOf(selectedId)
    onSelect(navIds[Math.min(navIds.length - 1, Math.max(0, i + delta))])
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (menuId) setMenuId(null)
      else onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter' && !e.target.closest?.('button, input[type="checkbox"]')) {
      e.preventDefault()
      if (!running) runSelected()
    }
  }

  const selected = templates.find((t) => t.id === selectedId) || null
  const rowProps = (t) => ({
    t,
    userId,
    selected: t.id === selectedId,
    checked: multi && checkedIds.has(t.id),
    onToggleChecked: multi ? onToggleChecked : null,
    ran: runTemplateIds.has(t.id),
    starred: favoriteIds.has(t.id),
    canFavorite: templatePermissions(t, userId).canFavorite,
    menuOpen: menuId === t.id,
    onSelect: (id) => { setMenuId(null); onSelect(id) },
    onToggleStar: onToggleFavorite,
    onToggleMenu: (id) => setMenuId((m) => (m === id ? null : id)),
    onEdit: (tpl) => { setMenuId(null); onEdit?.(tpl) },
    onDelete: (tpl) => { setMenuId(null); onDelete?.(tpl) },
  })
  const heading = 'text-[10px] font-black uppercase tracking-wider text-slate-400'

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} onKeyDown={onKeyDown}>
        <div
          role="dialog"
          aria-label={title}
          className="w-full max-w-4xl h-[80vh] flex flex-col bg-white dark:bg-surface-darkCard rounded-3xl border border-slate-200 dark:border-surface-darkBorder"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-5 pb-3 space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">{title}</h3>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates by name, description or category…"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 text-xs text-slate-900 dark:text-white font-semibold"
            />
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] border-y border-slate-100 dark:border-slate-800">
            <div ref={listRef} role="listbox" className="overflow-y-auto p-3 space-y-4">
              {matches.length === 0 && <p className="text-[11px] text-slate-400 p-2">No templates match your search.</p>}
              {sections.map((s) => (
                <div key={s.key} className="space-y-1">
                  <div className={heading}>{s.title}</div>
                  {s.items.map((t) => <Row key={`${s.key}-${t.id}`} {...rowProps(t)} />)}
                </div>
              ))}
              {groups.length > 0 && (
                <div className="space-y-1">
                  <div className={heading}>All templates</div>
                  {groups.map((g) => {
                    const open = searching || !collapsed.has(g.category)
                    return (
                      <div key={g.category}>
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setCollapsed((prev) => {
                            const next = new Set(prev)
                            next.has(g.category) ? next.delete(g.category) : next.add(g.category)
                            return next
                          })}
                          className="w-full flex items-center gap-1.5 py-1 text-[11px] font-black text-slate-600 dark:text-slate-300"
                        >
                          <span className="text-slate-400">{open ? '▾' : '▸'}</span> {g.category}
                          <span className="text-slate-400 font-semibold">({g.items.length})</span>
                        </button>
                        {open && g.items.map((t) => <Row key={`all-${t.id}`} {...rowProps(t)} />)}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="hidden md:block overflow-y-auto p-4 border-l border-slate-100 dark:border-slate-800">
              <Preview t={selected} userId={userId} ran={!!selected && runTemplateIds.has(selected.id)} showDefinition={showDefinition} />
            </div>
          </div>

          <div className="p-4 flex items-center justify-between gap-3 flex-wrap">
            {onShowOnChartChange ? (
              <label className="flex items-center gap-2 text-[11px] text-slate-500">
                <input type="checkbox" checked={showOnChart} onChange={(e) => onShowOnChartChange(e.target.checked)} /> Show on chart after run
              </label>
            ) : <span />}
            <div className="flex items-center gap-3">
              {onCreate && (
                <button type="button" className="text-[10px] font-black uppercase tracking-wider text-slate-400" onClick={onCreate}>
                  + Create new template
                </button>
              )}
              <button type="button" onClick={onClose} className={`${btn} bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200`}>Cancel</button>
              <button type="button" disabled={running || (!selectedId && checkedCount === 0)} onClick={runSelected} className={`${btn} bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50`}>
                {running ? busyLabel : checkedCount > 1 ? `${confirmLabel} ${checkedCount} templates` : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}
