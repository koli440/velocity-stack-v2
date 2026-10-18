'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { contextualHref, parseCoachPath } from '../lib/coachContext'
import Icon from './ActivityIcons'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/dateFormat'
import CalendarNoteDialog from './CalendarNoteDialog'
import { fetchProfilesByIds } from '../lib/social'
import { fetchNotesInRange, createNote, updateNote, deleteNote, noteProfileIds } from '../lib/calendarNotes'
import {
  buildMonthGrid,
  buildCalendarRows,
  monthRange,
  shiftMonth,
  addDays,
  formatDuration,
  formatKm,
  startOfDay,
  dayKey,
  fetchActivitiesInRange,
} from '../lib/calendar'

const defaultFetchEvents = (args) => fetchActivitiesInRange(supabase, args)
const defaultFetchNotes = (args) => fetchNotesInRange(supabase, args)

const DISCIPLINE_ICON = { track: 'velodrome', ride: 'bike' }

function EventChip({ event }) {
  const { riderId } = parseCoachPath(usePathname())
  const planned = event.kind === 'planned'
  return (
    <Link
      href={contextualHref(event.href, riderId)}
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

// Notes are the first thing in a day cell so the coach sees "ill" / "can train Tue" at a glance.
function NoteChip({ note, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(note)}
      title={note.body ? `${note.title}\n${note.body}` : note.title}
      data-testid="calendar-note"
      className="block w-full text-left rounded-lg px-1.5 py-1 text-[11px] leading-tight font-bold border border-amber-400/70 bg-amber-400/15 text-amber-900 dark:text-amber-200 hover:border-amber-500 transition"
    >
      <span className="flex items-center gap-1 min-w-0">
        <span aria-hidden>📝</span>
        <span className="truncate">{note.title}</span>
      </span>
    </button>
  )
}

function WeekSummary({ summary }) {
  const stat = (value, label) => (
    <div className="text-center md:text-left">
      <b className="block text-xl md:text-2xl font-black leading-tight text-emerald-700 dark:text-brand-neon">{value}</b>
      <span className="text-[10px] uppercase tracking-widest font-bold text-slate-600 dark:text-slate-300">{label}</span>
    </div>
  )
  return (
    <div
      className="rounded-xl border-2 border-emerald-500/50 bg-emerald-500/10 dark:bg-emerald-500/15 p-3 grid grid-cols-3 md:grid-cols-1 gap-2 md:content-center"
      aria-label="Week summary"
    >
      {stat(`${formatDuration(summary.durationS)} h`, 'Time')}
      {stat(formatKm(summary.distanceM), 'Distance')}
      {stat(summary.count, summary.count === 1 ? 'Activity' : 'Activities')}
    </div>
  )
}

/**
 * Month calendar of a rider's activities.
 * @param {string} [riderId]  rider whose calendar is shown; defaults to the signed-in user
 * @param {(args: {riderId: string, startISO: string, endISO: string}) => Promise<{data: Array, error: Error|null}>} fetchEvents
 *   returns day-cell events (see lib/calendar.js); only the visible range is requested.
 *   Defaults to the rider's activities from Supabase.
 * @param {Function} [fetchNotes]  same for calendar notes (RLS: only the rider and the rider's active coach get rows)
 */
export default function ActivityCalendar({ riderId: riderIdProp, fetchEvents = defaultFetchEvents, fetchNotes = defaultFetchNotes }) {
  const [sessionUserId, setSessionUserId] = useState(null)
  const riderId = riderIdProp || sessionUserId

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSessionUserId(session?.user?.id ?? null))
  }, [])

  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notes, setNotes] = useState([])
  const [names, setNames] = useState({})
  const [dialog, setDialog] = useState(null) // { day: Date, note: object|null }

  const { start, end, startISO, endISO } = useMemo(() => monthRange(anchor), [anchor])

  const load = useCallback(async () => {
    if (!riderId) return
    setLoading(true)
    setError(null)
    const [{ data, error: err }, { data: noteRows, error: noteErr }] = await Promise.all([
      fetchEvents({ riderId, startISO, endISO }),
      fetchNotes({ riderId, startDay: dayKey(start), endDay: dayKey(addDays(end, -1)) }),
    ])
    if (err) setError(err.message || 'Failed to load activities.')
    else if (noteErr) setError(noteErr.message || 'Failed to load notes.')
    setEvents(data || [])
    setNotes(noteRows || [])
    setLoading(false)
  }, [riderId, fetchEvents, fetchNotes, start, end, startISO, endISO])

  useEffect(() => {
    let cancelled = false
    load().catch((e) => !cancelled && (setError(e.message), setLoading(false)))
    return () => {
      cancelled = true
    }
  }, [load])

  const rows = useMemo(() => {
    return buildCalendarRows(buildMonthGrid(anchor), events, { anchor, notes })
  }, [anchor, events, notes])

  const nameKey = noteProfileIds(notes).sort().join(',')
  useEffect(() => {
    if (!nameKey) return
    let cancelled = false
    fetchProfilesByIds(supabase, nameKey.split(',')).then(({ profiles }) => {
      if (cancelled) return
      const out = {}
      for (const [id, p] of profiles) if (p?.display_name) out[id] = p.display_name
      setNames(out)
    })
    return () => {
      cancelled = true
    }
  }, [nameKey])

  const saveNote = async ({ title, body }) => {
    const { day, note } = dialog
    const { error: err } = note
      ? await updateNote(supabase, note.id, { day: dayKey(day), title, body })
      : await createNote(supabase, { riderId, day: dayKey(day), title, body })
    if (err) return err
    setDialog(null)
    await load()
    return null
  }

  const removeNote = async () => {
    const { error: err } = await deleteNote(supabase, dialog.note.id)
    if (err) return err
    setDialog(null)
    await load()
    return null
  }

  const title = formatDate(anchor, { month: 'long', year: 'numeric' })

  const weekdayLabels = rows[0]?.cells.map((c) => formatDate(c.date, { weekday: 'short' })) || []
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 hover:border-emerald-500 transition'

  return (
    <div className="glass-card bg-white dark:bg-surface-darkCard p-3 sm:p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button aria-label="Previous" className={btn} onClick={() => setAnchor(shiftMonth(anchor, -1))}>‹</button>
          <button className={btn} onClick={() => setAnchor(startOfDay(new Date()))}>Today</button>
          <button aria-label="Next" className={btn} onClick={() => setAnchor(shiftMonth(anchor, 1))}>›</button>
        </div>
        <h2 className="text-base font-extrabold text-slate-900 dark:text-white capitalize">{title}</h2>
        <span className="hidden sm:block w-[7.5rem]" aria-hidden />
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-semibold">{error}</div>
      )}

      <div className={`space-y-2 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
        <div className="hidden md:grid grid-cols-[repeat(7,minmax(0,1fr))_9rem] gap-1.5 text-[10px] uppercase tracking-widest font-bold text-slate-400">
          {weekdayLabels.map((l, i) => <div key={i} className="px-1">{l}</div>)}
          <div className="px-1">Week total</div>
        </div>
        {rows.map((row, ri) => (
          <div key={ri} className="grid grid-cols-1 md:grid-cols-[repeat(7,minmax(0,1fr))_9rem] gap-1.5">
            {row.cells.map((cell) => {
              const hideOnMobile = cell.events.length === 0 && cell.notes.length === 0 && !cell.isToday
              return (
                <div
                  key={cell.key}
                  className={`rounded-xl border p-1.5 min-h-[3rem] md:min-h-[6.5rem] space-y-1 ${hideOnMobile ? 'hidden md:block' : ''} ${
                    cell.isToday
                      ? 'border-emerald-500 bg-emerald-500/5'
                      : 'border-slate-200 dark:border-slate-800'
                  } ${cell.inMonth ? '' : 'opacity-50'}`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    <span>
                      <span className="md:hidden">{formatDate(cell.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                      <span className="hidden md:inline">{cell.date.getDate()}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Add note on ${formatDate(cell.date, { day: 'numeric', month: 'long' })}`}
                      title="Add note"
                      onClick={() => setDialog({ day: cell.date, note: null })}
                      className="px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-emerald-600"
                    >
                      +
                    </button>
                  </div>
                  {cell.notes.map((n) => <NoteChip key={n.id} note={n} onOpen={(note) => setDialog({ day: cell.date, note })} />)}
                  {cell.events.map((e) => <EventChip key={`${e.kind}-${e.id}`} event={e} />)}
                </div>
              )
            })}
            <WeekSummary summary={row.summary} />
          </div>
        ))}
      </div>
      {dialog && (
        <CalendarNoteDialog
          key={dialog.note?.id || `new-${dayKey(dialog.day)}`}
          note={dialog.note}
          dayLabel={formatDate(dialog.day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          names={names}
          viewerId={sessionUserId}
          onSave={saveNote}
          onDelete={removeNote}
          onClose={() => setDialog(null)}
        />
      )}
      {!loading && !error && events.length === 0 && (
        <p className="text-xs text-slate-400 text-center">No activities in this period.</p>
      )}
    </div>
  )
}
