'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Icon from './ActivityIcons'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/dateFormat'
import {
  buildMonthGrid,
  buildWeekGrid,
  buildCalendarRows,
  viewRange,
  shiftAnchor,
  formatDuration,
  formatKm,
  startOfDay,
  fetchActivitiesInRange,
} from '../lib/calendar'

const defaultFetchEvents = (args) => fetchActivitiesInRange(supabase, args)

const DISCIPLINE_ICON = { track: 'velodrome', ride: 'bike' }

function EventChip({ event }) {
  const planned = event.kind === 'planned'
  return (
    <Link
      href={event.href}
      className={`block rounded-lg px-1.5 py-1 text-[11px] leading-tight border transition hover:border-emerald-500 ${
        planned
          ? 'border-dashed border-sky-400/60 bg-sky-500/5'
          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60'
      }`}
    >
      <span className="flex items-center gap-1 font-bold text-slate-900 dark:text-white min-w-0">
        <Icon name={DISCIPLINE_ICON[event.discipline] || 'bike'} size={12} className="shrink-0 text-emerald-600 dark:text-brand-neon" />
        <span className="truncate">{event.title}</span>
      </span>
      <span className="block text-slate-500 dark:text-slate-400 truncate">
        {[event.distanceM ? formatKm(event.distanceM) : null, event.durationS ? formatDuration(event.durationS) : null, event.metric?.value]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </Link>
  )
}

function WeekSummary({ summary, className = '' }) {
  return (
    <div className={`text-[11px] text-slate-500 dark:text-slate-400 ${className}`}>
      <span className="block text-[9px] uppercase tracking-widest font-bold">Week</span>
      <b className="text-slate-900 dark:text-white">{formatDuration(summary.durationS)} h</b>
      <span className="block">{formatKm(summary.distanceM)}</span>
      <span className="block">{summary.count} {summary.count === 1 ? 'activity' : 'activities'}</span>
    </div>
  )
}

/**
 * Month/week calendar of a rider's activities.
 * @param {string} [riderId]  rider whose calendar is shown; defaults to the signed-in user
 * @param {(args: {riderId: string, startISO: string, endISO: string}) => Promise<{data: Array, error: Error|null}>} fetchEvents
 *   returns day-cell events (see lib/calendar.js); only the visible range is requested.
 *   Defaults to the rider's activities from Supabase.
 */
export default function ActivityCalendar({ riderId: riderIdProp, fetchEvents = defaultFetchEvents }) {
  const [sessionUserId, setSessionUserId] = useState(null)
  const riderId = riderIdProp || sessionUserId

  useEffect(() => {
    if (riderIdProp) return
    supabase.auth.getSession().then(({ data: { session } }) => setSessionUserId(session?.user?.id ?? null))
  }, [riderIdProp])

  const [view, setView] = useState('month')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const { start, end, startISO, endISO } = useMemo(() => viewRange(view, anchor), [view, anchor])

  const load = useCallback(async () => {
    if (!riderId) return
    setLoading(true)
    setError(null)
    const { data, error: err } = await fetchEvents({ riderId, startISO, endISO })
    if (err) setError(err.message || 'Failed to load activities.')
    setEvents(data || [])
    setLoading(false)
  }, [riderId, fetchEvents, startISO, endISO])

  useEffect(() => {
    let cancelled = false
    load().catch((e) => !cancelled && (setError(e.message), setLoading(false)))
    return () => {
      cancelled = true
    }
  }, [load])

  const rows = useMemo(() => {
    const weeks = view === 'week' ? buildWeekGrid(anchor) : buildMonthGrid(anchor)
    return buildCalendarRows(weeks, events, { anchor: view === 'month' ? anchor : undefined })
  }, [view, anchor, events])

  const title =
    view === 'month'
      ? formatDate(anchor, { month: 'long', year: 'numeric' })
      : `${formatDate(start, { day: 'numeric', month: 'short' })} – ${formatDate(new Date(end.getTime() - 1), { day: 'numeric', month: 'short', year: 'numeric' })}`

  const weekdayLabels = rows[0]?.cells.map((c) => formatDate(c.date, { weekday: 'short' })) || []
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 hover:border-emerald-500 transition'

  return (
    <div className="glass-card bg-white dark:bg-surface-darkCard p-3 sm:p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button aria-label="Previous" className={btn} onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}>‹</button>
          <button className={btn} onClick={() => setAnchor(startOfDay(new Date()))}>Today</button>
          <button aria-label="Next" className={btn} onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}>›</button>
        </div>
        <h2 className="text-base font-extrabold text-slate-900 dark:text-white capitalize">{title}</h2>
        <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
          {['month', 'week'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs font-bold capitalize ${view === v ? 'bg-emerald-500 text-slate-950' : 'text-slate-500 dark:text-slate-300'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-semibold">{error}</div>
      )}

      <div className={`space-y-2 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
        <div className="hidden md:grid grid-cols-[repeat(7,minmax(0,1fr))_7rem] gap-1.5 text-[10px] uppercase tracking-widest font-bold text-slate-400">
          {weekdayLabels.map((l, i) => <div key={i} className="px-1">{l}</div>)}
          <div className="px-1">Summary</div>
        </div>
        {rows.map((row, ri) => (
          <div key={ri} className="grid grid-cols-1 md:grid-cols-[repeat(7,minmax(0,1fr))_7rem] gap-1.5">
            {row.cells.map((cell) => {
              const hideOnMobile = view === 'month' && cell.events.length === 0 && !cell.isToday
              return (
                <div
                  key={cell.key}
                  className={`rounded-xl border p-1.5 min-h-[3rem] md:min-h-[6.5rem] space-y-1 ${hideOnMobile ? 'hidden md:block' : ''} ${
                    cell.isToday
                      ? 'border-emerald-500 bg-emerald-500/5'
                      : 'border-slate-200 dark:border-slate-800'
                  } ${cell.inMonth ? '' : 'opacity-50'}`}
                >
                  <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    <span className="md:hidden">{formatDate(cell.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    <span className="hidden md:inline">{cell.date.getDate()}</span>
                  </div>
                  {cell.events.map((e) => <EventChip key={`${e.kind}-${e.id}`} event={e} />)}
                </div>
              )
            })}
            <WeekSummary summary={row.summary} className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-2" />
          </div>
        ))}
      </div>
      {!loading && !error && events.length === 0 && (
        <p className="text-xs text-slate-400 text-center">No activities in this period.</p>
      )}
    </div>
  )
}
