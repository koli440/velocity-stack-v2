'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Icon from './Icon'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/dateFormat'
import {
  SESSION_SEARCH_DEBOUNCE_MS,
  isSearchable,
  normalizeSearchTerm,
  searchSessions,
} from '../lib/sessionSearch'

export default function SessionSearch({ userId, tracks = [] }) {
  const router = useRouter()
  const listId = useId()
  const rootRef = useRef(null)
  const requestRef = useRef(0)
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState([])
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(-1)

  const searchable = isSearchable(query)

  useEffect(() => {
    const id = ++requestRef.current
    setActive(-1)
    setFailed(false)
    if (!userId || !isSearchable(query)) {
      setResults([])
      setLoading(false)
      return undefined
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      const { data, error } = await searchSessions(supabase, {
        userId,
        term: normalizeSearchTerm(query),
        tracks: tracksRef.current,
      })
      if (id !== requestRef.current) return
      setResults(error ? [] : data)
      setFailed(Boolean(error))
      setLoading(false)
    }, SESSION_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, userId])

  useEffect(() => {
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [])

  const choose = (item) => {
    requestRef.current++
    setOpen(false)
    setQuery('')
    setResults([])
    setLoading(false)
    router.push(`/activities/${item.id}`)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      if (results.length) setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length) setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter' && open && active >= 0 && results[active]) {
      e.preventDefault()
      choose(results[active])
    }
  }

  const showPanel = open && searchable
  const trackName = (r) => r.tracks?.name || tracks.find((t) => t.id === r.track_id)?.name || ''

  return (
    <div className="w-full relative" ref={rootRef}>
      <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        type="text"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-label="Search my sessions"
        autoComplete="off"
        value={query}
        disabled={!userId}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search my sessions…"
        className="w-full bg-slate-50 dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-xl pl-9 pr-3.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
      />
      {showPanel && (
        <div className="glass-popover absolute left-0 right-0 mt-2 z-40 max-h-80 overflow-y-auto rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder shadow-lg">
          <ul id={listId} role="listbox" aria-label="Session results" className="p-1">
            {results.map((r, i) => (
              <li
                key={r.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r)}
                className={`cursor-pointer rounded-xl px-3 py-2 text-xs ${
                  i === active ? 'bg-emerald-500/15' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <div className="font-semibold text-slate-900 dark:text-white truncate">{r.title || 'Untitled session'}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {[trackName(r), formatDate(r.activity_date)].filter(Boolean).join(' · ')}
                </div>
              </li>
            ))}
          </ul>
          {loading && <div role="status" className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">Searching…</div>}
          {!loading && failed && <div role="status" className="px-4 py-3 text-xs text-rose-500">Search failed. Try again.</div>}
          {!loading && !failed && results.length === 0 && (
            <div role="status" className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">No sessions found</div>
          )}
        </div>
      )}
    </div>
  )
}
