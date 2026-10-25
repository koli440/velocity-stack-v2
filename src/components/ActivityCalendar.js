'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { contextualHref, parseCoachPath } from '../lib/coachContext'
import { withReturnTo } from '../lib/returnTo'
import Icon from './ActivityIcons'
import { PLANNED_STATUS_ICONS, PUSH_STATE_ICONS, CALENDAR_ICONS } from '../lib/calendarIcons'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/dateFormat'
import CalendarNoteDialog from './CalendarNoteDialog'
import CalendarRaceDialog from './CalendarRaceDialog'
import RaceBadge from './RaceBadge'
import PlannedWorkoutDialog, { STATUS_STYLES } from './PlannedWorkoutDialog'
import { fetchPushRows } from '../lib/plannedPushClient'
import { pushState, PUSH_STATE_LABELS } from '../lib/intervalsWorkout'
import {
  fetchPlannedInRange,
  plannedToEvent,
  plannedProfileIds,
  PLANNED_STATUS_LABELS,
  suggestMatches,
  runForPlanned,
  countPlannedByDay,
  canMoveTo,
  createPlanned,
  updatePlanned,
  movePlanned,
  setPlannedSkipped,
  deletePlanned,
  duplicatePlanned,
  setPlannedStructure,
  linkPlannedActivity,
  unlinkPlannedActivity,
} from '../lib/plannedWorkouts'
import {
  fetchRacesInRange,
  createRace,
  updateRace,
  deleteRace,
  raceProfileIds,
  raceTimeLabel,
  racesByActivity,
  RACE_PRIORITY_STYLES,
  RACE_PRIORITY_LABELS,
  RACE_DISCIPLINE_LABELS,
} from '../lib/calendarRaces'
import { fetchFtpHistory } from '../lib/ftpHistory'
import { fetchProfilesByIds } from '../lib/social'
import { isShownOnMobile, isEmptyDay } from '../lib/calendarMobileDays'
import { fetchNotesInRange, createNote, updateNote, deleteNote, noteProfileIds } from '../lib/calendarNotes'
import {
  buildMonthGrid,
  buildCalendarRows,
  monthRange,
  shiftMonth,
  monthParam,
  parseMonthParam,
  addDays,
  formatDuration,
  formatKm,
  startOfDay,
  dayKey,
  fetchActivitiesInRange,
} from '../lib/calendar'

const defaultFetchEvents = (args) => fetchActivitiesInRange(supabase, args)
const defaultFetchNotes = (args) => fetchNotesInRange(supabase, args)
const defaultFetchPlanned = (args) => fetchPlannedInRange(supabase, args)
const defaultFetchRaces = (args) => fetchRacesInRange(supabase, args)

const DISCIPLINE_ICON = { track: 'velodrome', ride: 'bike' }

// Shared stacked layout: meta line (icon, label, right-aligned extras), name on its own line, wrapping stats.
function ChipBody({ icon, iconClass, label, extras, name, stats }) {
  const items = stats.filter(Boolean)
  return (
    <>
      <span className="flex items-center gap-1 min-w-0 text-[9px] font-bold uppercase tracking-wide opacity-80">
        <Icon name={icon} size={12} className={`shrink-0 ${iconClass || ''}`} />
        <span className="truncate">{label}</span>
        {extras && <span className="ml-auto flex items-center gap-1 shrink-0">{extras}</span>}
      </span>
      <span className="block mt-0.5 text-xs font-bold leading-snug break-words line-clamp-2" data-testid="calendar-chip-name">{name}</span>
      {items.length > 0 && (
        <span className="mt-0.5 flex flex-wrap gap-x-1.5 text-[10px] font-semibold opacity-80" data-testid="calendar-chip-stats">
          {items.map((t, i) => <span key={i} className={i === 0 ? 'font-bold' : undefined}>{t}</span>)}
        </span>
      )}
    </>
  )
}

function EventChip({ event, race, returnTo }) {
  const { riderId } = parseCoachPath(usePathname())
  const planned = event.kind === 'planned'
  const pushed = event.pushState && event.pushState !== 'not_pushed'
  return (
    <Link
      href={withReturnTo(contextualHref(event.href, riderId), returnTo)}
      data-testid={race ? 'calendar-race-activity' : undefined}
      data-race-tag={event.isRace ? 'true' : undefined}
      title={[race ? `${race.name} · ${RACE_PRIORITY_LABELS[race.priority]}` : null, event.isRace ? 'Race' : null].filter(Boolean).join(' · ') || undefined}
      className={`block rounded-lg px-1.5 py-1 text-[11px] leading-tight border transition hover:border-emerald-500 text-slate-900 dark:text-white ${event.isRace ? 'border-l-4 border-l-amber-500' : ''} ${
        race
          ? RACE_PRIORITY_STYLES[race.priority]
          : planned
            ? 'border-dashed border-sky-400/60 bg-sky-500/5'
            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60'
      }`}
    >
      <ChipBody
        icon={race ? CALENDAR_ICONS.race : DISCIPLINE_ICON[event.discipline] || 'bike'}
        iconClass={race ? 'text-rose-500' : 'text-emerald-600 dark:text-brand-neon'}
        label={race ? `Race · ${race.priority}` : planned ? 'Planned' : 'Ride'}
        extras={(event.isRace || pushed) && (
          <>
            {event.isRace && <RaceBadge testId="calendar-race-tag" size="xs" />}
            {pushed && (
              <span aria-label={PUSH_STATE_LABELS[event.pushState]} data-testid="calendar-planned-push" data-state={event.pushState} className="shrink-0">
                <Icon name={PUSH_STATE_ICONS[event.pushState]} size={12} />
              </span>
            )}
          </>
        )}
        name={race ? race.name : event.title}
        stats={[event.distanceM ? formatKm(event.distanceM) : null, event.durationS ? formatDuration(event.durationS) : null, event.metric?.value]}
      />
    </Link>
  )
}

// Planned workouts open the detail dialog and can be dragged to another day (the dialog has a date field as fallback).
function PlannedChip({ event, onOpen }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', event.plannedId)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => onOpen(event.plannedId)}
      data-testid="calendar-planned"
      data-status={event.status}
      title={`${event.title} · ${PLANNED_STATUS_LABELS[event.status]}${event.pushState && event.pushState !== 'not_pushed' ? ` · ${PUSH_STATE_LABELS[event.pushState]}` : ''}`}
      className={`block w-full text-left rounded-lg px-1.5 py-1 text-[11px] leading-tight border cursor-grab hover:border-emerald-500 transition ${STATUS_STYLES[event.status]}`}
    >
      <ChipBody
        icon={PLANNED_STATUS_ICONS[event.status]}
        label={PLANNED_STATUS_LABELS[event.status]}
        extras={event.pushState && event.pushState !== 'not_pushed' && (
          <span aria-label={PUSH_STATE_LABELS[event.pushState]}>
            <Icon name={PUSH_STATE_ICONS[event.pushState]} size={12} />
          </span>
        )}
        name={event.title}
        stats={[event.durationS ? formatDuration(event.durationS) : null, event.metric?.value]}
      />
    </button>
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
      className="block w-full text-left rounded-lg px-1.5 py-1 text-[11px] leading-tight border border-amber-400/70 bg-amber-400/15 text-amber-900 dark:text-amber-200 hover:border-amber-500 transition"
    >
      <ChipBody icon={CALENDAR_ICONS.note} label="Note" name={note.title} stats={[]} />
    </button>
  )
}

// Races are priority-coloured flag chips (A red, B orange, C grey); click opens the dialog.
function RaceChip({ race, onOpen }) {
  const time = raceTimeLabel(race)
  return (
    <button
      type="button"
      onClick={() => onOpen(race)}
      data-testid="calendar-race"
      data-priority={race.priority}
      title={[`${race.name} · ${RACE_PRIORITY_LABELS[race.priority]} · ${RACE_DISCIPLINE_LABELS[race.discipline]}`, time, race.location, race.format_note].filter(Boolean).join('\n')}
      className={`block w-full text-left rounded-lg px-1.5 py-1 text-[11px] leading-tight border hover:brightness-110 transition ${RACE_PRIORITY_STYLES[race.priority]}`}
    >
      <ChipBody
        icon={CALENDAR_ICONS.race}
        label={`Race · ${race.priority}`}
        name={race.name}
        stats={[time, race.activity_id ? 'ridden' : null]}
      />
    </button>
  )
}

// Planned vs done time of the week: "planned 8:00 h" (with "+" when some durations are unknown) and a thin progress bar.
function PlannedTime({ summary }) {
  const pct = summary.plannedDurationS > 0 ? Math.min(100, Math.round((summary.durationS / summary.plannedDurationS) * 100)) : 0
  return (
    <div className="col-span-3 lg:col-span-1 space-y-1" data-testid="week-planned-time" data-partial={summary.plannedPartial ? 'true' : 'false'}>
      <div className="text-[10px] font-bold text-sky-700 dark:text-sky-300 text-center lg:text-left">
        {summary.plannedDurationS > 0
          ? `planned ${formatDuration(summary.plannedDurationS)} h${summary.plannedPartial ? '+' : ''}`
          : 'planned time unknown'}
        {summary.plannedPartial && summary.plannedDurationS > 0 ? ' (some durations unknown)' : ''}
      </div>
      {summary.plannedDurationS > 0 && (
        <div className="h-1.5 rounded-full bg-sky-500/20 overflow-hidden" role="progressbar" aria-label="Done vs planned time" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

function WeekSummary({ summary }) {
  const stat = (value, label) => (
    <div className="text-center lg:text-left">
      <b className="block text-xl lg:text-2xl font-black leading-tight text-emerald-700 dark:text-brand-neon">{value}</b>
      <span className="text-[10px] uppercase tracking-widest font-bold text-slate-600 dark:text-slate-300">{label}</span>
    </div>
  )
  return (
    <div
      className="rounded-xl border-2 border-emerald-500/50 bg-emerald-500/10 dark:bg-emerald-500/15 p-3 grid grid-cols-3 lg:grid-cols-1 gap-2 lg:content-center"
      aria-label="Week summary"
    >
      {stat(`${formatDuration(summary.durationS)} h`, 'Time')}
      {stat(formatKm(summary.distanceM), 'Distance')}
      {stat(summary.count, summary.count === 1 ? 'Activity' : 'Activities')}
      {summary.raceActivityCount > 0 && (
        <span className="col-span-3 lg:col-span-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 text-center lg:text-left" data-testid="week-race-activities">
          <Icon name={CALENDAR_ICONS.raceRidden} size={12} /> {summary.raceActivityCount} {summary.raceActivityCount === 1 ? 'race' : 'races'} ridden
        </span>
      )}
      {summary.plannedCount > 0 && <PlannedTime summary={summary} />}
      {summary.races?.length > 0 && (
        <span className="col-span-3 lg:col-span-1 text-[10px] font-bold text-rose-600 dark:text-rose-300 text-center lg:text-left" data-testid="week-races">
          {summary.races.map((r, i) => (
            <span key={r.id ?? i}>{i > 0 && ' · '}<Icon name={CALENDAR_ICONS.race} size={12} /> {r.name} ({r.priority})</span>
          ))}
        </span>
      )}
      {summary.plannedCount > 0 && (
        <span className="col-span-3 lg:col-span-1 text-[10px] font-bold text-sky-600 dark:text-sky-300 text-center lg:text-left">
          {summary.plannedCount} planned
        </span>
      )}
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
 * @param {Function} [fetchRaces]  same for races (RLS: only the rider and the rider's active coach get rows)
 * @param {Function} [fetchPlanned]  same for planned workouts (RLS: only the rider and the rider's active coach get rows)
 */
export default function ActivityCalendar({ riderId: riderIdProp, fetchEvents = defaultFetchEvents, fetchNotes = defaultFetchNotes, fetchPlanned = defaultFetchPlanned, fetchRaces = defaultFetchRaces }) {
  const [sessionUserId, setSessionUserId] = useState(null)
  const riderId = riderIdProp || sessionUserId

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSessionUserId(session?.user?.id ?? null))
  }, [])

  const pathname = usePathname()
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  // The shown month lives in the URL (?month=YYYY-MM) so an activity opened from here can link back to it.
  useEffect(() => {
    const m = parseMonthParam(new URLSearchParams(window.location.search).get('month'))
    if (m) setAnchor(m)
  }, [])
  const monthKey = monthParam(anchor)
  const isCurrentMonth = monthKey === monthParam(new Date())
  const returnTo = `${pathname}${isCurrentMonth ? '' : `?month=${monthKey}`}`
  useEffect(() => {
    const url = new URL(window.location.href)
    if (isCurrentMonth) url.searchParams.delete('month')
    else url.searchParams.set('month', monthKey)
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  }, [monthKey, isCurrentMonth])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notes, setNotes] = useState([])
  const [names, setNames] = useState({})
  const [dialog, setDialog] = useState(null) // { day: Date, note: object|null }
  const [races, setRaces] = useState([])
  const [rdialog, setRdialog] = useState(null) // { day: Date, race: object|null }
  const [planned, setPlanned] = useState([])
  const [runs, setRuns] = useState([])
  const [pdialog, setPdialog] = useState(null) // { day: Date, id: string|null }
  const [pushRows, setPushRows] = useState(new Map())
  const [pushTick, setPushTick] = useState(0)

  const { start, end, startISO, endISO } = useMemo(() => monthRange(anchor), [anchor])

  const load = useCallback(async () => {
    if (!riderId) return
    setLoading(true)
    setError(null)
    const range = { riderId, startDay: dayKey(start), endDay: dayKey(addDays(end, -1)) }
    const [{ data, error: err }, { data: noteRows, error: noteErr }, { data: plannedRows, error: plannedErr }, { data: raceRows, error: raceErr }] = await Promise.all([
      fetchEvents({ riderId, startISO, endISO }),
      fetchNotes(range),
      fetchPlanned(range),
      fetchRaces(range),
    ])
    if (err) setError(err.message || 'Failed to load activities.')
    else if (noteErr) setError(noteErr.message || 'Failed to load notes.')
    else if (plannedErr) setError(plannedErr.message || 'Failed to load planned workouts.')
    else if (raceErr) setError(raceErr.message || 'Failed to load races.')
    setEvents(data || [])
    setNotes(noteRows || [])
    setPlanned(plannedRows || [])
    setRaces(raceRows || [])
    // Run results of linked activities (RLS: rider and the rider's active coach).
    const linkedIds = (plannedRows || []).map((w) => w.activity_id).filter(Boolean)
    if (linkedIds.length) {
      const { data: runRows } = await supabase
        .from('template_executions')
        .select('id, activity_id, template_name, summary, created_at')
        .eq('user_id', riderId)
        .in('activity_id', linkedIds)
        .order('created_at', { ascending: false })
      setRuns(runRows || [])
    } else setRuns([])
    setLoading(false)
  }, [riderId, fetchEvents, fetchNotes, fetchPlanned, fetchRaces, start, end, startISO, endISO])

  useEffect(() => {
    let cancelled = false
    load().catch((e) => !cancelled && (setError(e.message), setLoading(false)))
    return () => {
      cancelled = true
    }
  }, [load])

  // Status is derived from "today", so recompute when a page that stays open passes midnight.
  const [todayKey, setTodayKey] = useState(() => dayKey(new Date()))
  useEffect(() => {
    const id = setInterval(() => setTodayKey((k) => { const n = dayKey(new Date()); return n === k ? k : n }), 60000)
    return () => clearInterval(id)
  }, [])
  const rows = useMemo(() => {
    const today = new Date()
    return buildCalendarRows(buildMonthGrid(anchor), [...events, ...planned.map((w) => ({ ...plannedToEvent(w, today), pushState: pushState(w, pushRows.get(w.id)) }))], { anchor, notes, races })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, events, notes, races, planned, pushRows, todayKey])
  const raceByActivity = useMemo(() => racesByActivity(races), [races])

  // Intervals.icu push status of the visible workouts (RLS: rider + active coach; empty for everyone else).
  useEffect(() => {
    let cancelled = false
    fetchPushRows(supabase, planned.map((w) => w.id)).then((m) => !cancelled && setPushRows(m)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [planned, pushTick])

  const plannedById = useMemo(() => new Map(planned.map((w) => [w.id, w])), [planned])
  const countByDay = useMemo(() => countPlannedByDay(planned), [planned])
  const suggestions = useMemo(() => suggestMatches(planned, events), [planned, events])

  const nameKey = [...new Set([...noteProfileIds(notes), ...plannedProfileIds(planned), ...raceProfileIds(races)])].sort().join(',')
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

  const saveRace = async (draft) => {
    const { day, race } = rdialog
    const { day: chosen, ...fields } = draft
    const { error: err } = race
      ? await updateRace(supabase, race.id, { day: chosen, ...fields })
      : await createRace(supabase, { riderId, day: chosen, ...fields })
    if (err) return err
    setRdialog(null)
    await load()
    return null
  }

  const removeRace = async () => {
    const { error: err } = await deleteRace(supabase, rdialog.race.id)
    if (err) return err
    setRdialog(null)
    await load()
    return null
  }

  const openPlanned = (day, id) => setPdialog({ day, id })

  const [ftpHistory, setFtpHistory] = useState([])
  useEffect(() => {
    if (!riderId) return undefined
    let cancelled = false
    fetchFtpHistory(supabase, riderId).then(({ history }) => !cancelled && setFtpHistory(history || [])).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [riderId])

  const refresh = async (fn) => {
    const { error: err } = await fn()
    if (err) return err
    await load()
    return null
  }

  const plannedActions = (id) => ({
    create: (f) => refresh(() => createPlanned(supabase, { riderId, ...f })),
    update: (f) => refresh(() => updatePlanned(supabase, id, f)),
    setStructure: (st) => refresh(() => setPlannedStructure(supabase, id, st)),
    move: (day) => refresh(() => movePlanned(supabase, id, day)),
    duplicate: (day) => refresh(() => duplicatePlanned(supabase, id, day)),
    skip: (v) => refresh(() => setPlannedSkipped(supabase, id, v)),
    pushChanged: () => setPushTick((n) => n + 1),
    link: (a) => refresh(() => linkPlannedActivity(supabase, id, a)),
    unlink: () => refresh(() => unlinkPlannedActivity(supabase, id)),
    remove: () => refresh(() => deletePlanned(supabase, id)),
  })

  const dropOnDay = async (e, day) => {
    e.preventDefault()
    const w = plannedById.get(e.dataTransfer.getData('text/plain'))
    if (!w) return
    const target = dayKey(day)
    const check = canMoveTo(w, target, countByDay)
    if (!check.ok) return check.reason === 'Already on that day.' ? undefined : setError(check.reason)
    const { error: err } = await movePlanned(supabase, w.id, target)
    if (err) setError(err.message)
    else await load()
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
        <div className="hidden lg:grid grid-cols-[repeat(7,minmax(0,1fr))_9rem] gap-1.5 text-[10px] uppercase tracking-widest font-bold text-slate-400">
          {weekdayLabels.map((l, i) => <div key={i} className="px-1">{l}</div>)}
          <div className="px-1">Week total</div>
        </div>
        {rows.map((row, ri) => (
          <div key={ri} className="grid grid-cols-1 lg:grid-cols-[repeat(7,minmax(0,1fr))_9rem] gap-1.5">
            {row.cells.map((cell) => {
              const hideOnMobile = !isShownOnMobile(cell)
              const slimOnMobile = isEmptyDay(cell)
              return (
                <div
                  key={cell.key}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => dropOnDay(e, cell.date)}
                  className={`rounded-xl border p-1.5 ${slimOnMobile ? 'min-h-[1.75rem] py-0.5 opacity-80 lg:py-1.5 lg:opacity-100' : 'min-h-[3rem]'} lg:min-h-[6.5rem] space-y-1 ${hideOnMobile ? 'hidden lg:block' : ''} ${
                    cell.isToday
                      ? 'border-emerald-500 bg-emerald-500/5'
                      : 'border-slate-200 dark:border-slate-800'
                  } ${cell.inMonth ? '' : 'opacity-50'}`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    <span>
                      <span className="lg:hidden">{formatDate(cell.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                      <span className="hidden lg:inline">{cell.date.getDate()}</span>
                    </span>
                    <span className="flex items-center">
                    <button
                      type="button"
                      aria-label={`Plan workout on ${formatDate(cell.date, { day: 'numeric', month: 'long' })}`}
                      title="Plan workout"
                      onClick={() => openPlanned(cell.date, null)}
                      className="px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-sky-600"
                    >
                      <Icon name={CALENDAR_ICONS.plan} size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Add note on ${formatDate(cell.date, { day: 'numeric', month: 'long' })}`}
                      title="Add note"
                      onClick={() => setDialog({ day: cell.date, note: null })}
                      className="px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-emerald-600"
                    >
                      <Icon name={CALENDAR_ICONS.note} size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Add race on ${formatDate(cell.date, { day: 'numeric', month: 'long' })}`}
                      title="Add race"
                      onClick={() => setRdialog({ day: cell.date, race: null })}
                      className="px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-rose-600"
                    >
                      <Icon name={CALENDAR_ICONS.race} size={14} />
                    </button>
                    </span>
                  </div>
                  {cell.notes.map((n) => <NoteChip key={n.id} note={n} onOpen={(note) => setDialog({ day: cell.date, note })} />)}
                  {cell.races.map((r) => <RaceChip key={r.id} race={r} onOpen={(race) => setRdialog({ day: cell.date, race })} />)}
                  {cell.events.map((e) => (e.kind === 'planned'
                    ? <PlannedChip key={`planned-${e.id}`} event={e} onOpen={(id) => openPlanned(cell.date, id)} />
                    : <EventChip key={`${e.kind}-${e.id}`} event={e} race={raceByActivity.get(e.id)} returnTo={returnTo} />))}
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
      {rdialog && (
        <CalendarRaceDialog
          key={rdialog.race?.id || `new-${dayKey(rdialog.day)}`}
          race={rdialog.race}
          day={rdialog.race?.race_date || dayKey(rdialog.day)}
          dayLabel={formatDate(rdialog.day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          names={names}
          viewerId={sessionUserId}
          activities={events}
          races={races}
          onSave={saveRace}
          onDelete={removeRace}
          onClose={() => setRdialog(null)}
        />
      )}
      {pdialog && (() => {
        const w = pdialog.id ? plannedById.get(pdialog.id) : null
        if (pdialog.id && !w) return null
        return (
          <PlannedWorkoutDialog
            key={pdialog.id || `new-${dayKey(pdialog.day)}`}
            workout={w}
            day={pdialog.day}
            names={names}
            viewerId={sessionUserId}
            activities={events}
            workouts={planned}
            countByDay={countByDay}
            suggestedActivityId={w ? suggestions.get(w.id) : null}
            run={w ? runForPlanned(w, runs) : null}
            ftpHistory={ftpHistory}
            actions={plannedActions(pdialog.id)}
            onClose={() => setPdialog(null)}
          />
        )
      })()}
      {!loading && !error && events.length === 0 && (
        <p className="text-xs text-slate-400 text-center">No activities in this period.</p>
      )}
    </div>
  )
}
