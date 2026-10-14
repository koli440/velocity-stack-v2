'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { filterTracks, formatTrackMeta } from '../lib/trackSearch'

// Shared searchable velodrome picker. Controlled via `value` (track id or '') / `onChange(id)`.
// Reuse this anywhere a velodrome must be chosen. `emptyLabel` set => user can clear the selection.
export default function VelodromePicker({
  tracks = [],
  value = '',
  onChange,
  emptyLabel = null,
  placeholder = 'Search velodrome by name, city or country…',
  disabled = false,
  compact = false,
  favoriteId: favoriteProp,
  defaultToFavorite = false,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [profileFavorite, setProfileFavorite] = useState(null)
  const rootRef = useRef(null)
  const defaultedRef = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const valueRef = useRef(value)
  valueRef.current = value

  // The user's favorite velodrome is the home track from their profile settings.
  useEffect(() => {
    if (favoriteProp !== undefined) return
    let cancelled = false
    ;(async () => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth?.user) return
      const { data } = await supabase
        .from('profiles')
        .select('home_track_id')
        .eq('id', auth.user.id)
        .maybeSingle()
      if (!cancelled) setProfileFavorite(data?.home_track_id || null)
    })().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [favoriteProp])

  const favoriteId = favoriteProp !== undefined ? favoriteProp : profileFavorite
  const favorite = tracks.find((t) => t.id === favoriteId) || null

  // Preselect the favorite once, only if nothing is selected yet.
  useEffect(() => {
    if (!defaultToFavorite || defaultedRef.current || !favorite) return
    defaultedRef.current = true
    if (!valueRef.current) onChangeRef.current(favorite.id)
  }, [defaultToFavorite, favorite])

  const selected = tracks.find((t) => t.id === value) || null
  const results = useMemo(() => filterTracks(tracks, query, favorite?.id), [tracks, query, favorite])

  useEffect(() => {
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const choose = (id) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      if (results[active]) choose(results[active].id)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const pad = compact ? 'p-2.5 text-xs' : 'px-3.5 py-2.5 text-sm'
  const shown = open ? query : selected ? selected.name : ''

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          disabled={disabled}
          value={shown}
          placeholder={selected ? selected.name : emptyLabel || placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          className={`w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl ${pad} pr-8 font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-50`}
        />
        {emptyLabel && selected && !disabled && (
          <button
            type="button"
            aria-label="Clear velodrome"
            onClick={() => choose('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white"
          >
            ✕
          </button>
        )}
      </div>
      {selected && !open && (
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{formatTrackMeta(selected)}</p>
      )}
      {open && (
        <ul
          role="listbox"
          className="glass-popover absolute z-40 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl"
        >
          {emptyLabel && (
            <li
              role="option"
              aria-selected={!value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose('')}
              className="px-3.5 py-2 text-xs font-semibold text-slate-500 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {emptyLabel}
            </li>
          )}
          {results.length === 0 && (
            <li className="px-3.5 py-3 text-xs text-slate-400">No velodromes match “{query}”.</li>
          )}
          {results.map((t, i) => (
            <li
              key={t.id}
              role="option"
              aria-selected={t.id === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(t.id)}
              className={`px-3.5 py-2 cursor-pointer ${
                i === active ? 'bg-emerald-500/10' : ''
              } ${t.id === value ? 'font-black' : ''}`}
            >
              <div className="text-xs font-bold text-slate-900 dark:text-white">
                {t.id === favorite?.id && <span title="Your home velodrome">★ </span>}
                {t.name}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{formatTrackMeta(t)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
