'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useRaceForms } from './useRaceForms'
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
import { useRiderLoadContext } from './useRiderLoadContext'
import { fetchProfilesByIds } from '../lib/social'
import { shouldAutoScrollToToday, todayScrollBehavior } from '../lib/calendarScroll'
import { isShownOnMobile, isEmptyDay } from '../lib/calendarMobileDays'
import { addLoadToRows, completedEventLoad, unscoredReason, UNSCORED_REASONS, overPlan, monthTotals } from '../lib/calendarLoad'
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
  activityChipLabel,
} from '../lib/calendar'

const defaultFetchEvents = (args) => fetchActivitiesInRange(supabase, args)
const defaultFetchNotes = (args) => fetchNotesInRange(supabase, args)
const defaultFetchPlanned = (args) => fetchPlannedInRange(supabase, args)
const defaultFetchRaces = (args) => fetchRacesInRange(supabase, args)

const DISCIPLINE_ICON = { track: 'velodrome', ride: 'bike', gym: 'flame', run: 'run' }

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
          {items.map((t, i) => <span key={i} className={i === 0 && typeof t === 'string' ? 'font-bold' : undefined}>{t}</span>)}
        </span>
      )}
    </>
  )
}

// Completed load: solid pill "TL 85" ("TL ~85" for HR / gym estimates). Gym excluded from fitness is dimmed and not counted.
function TlBadge({ tl, hint }) {
  if (!tl && hint) {
    return (
      <span data-testid="calendar-no-tl" title={hint} className="rounded px-1 font-semibold border border-slate-400/60 text-slate-500 dark:text-slate-400 dark:border-slate-500/60">
        no TL
      </span>
    )
  }
  if (!tl) return null
  const label = `TL ${tl.estimated ? '~' : ''}${Math.round(tl.load)}`
  const title = [tl.estimated ? 'Estimated training load' : 'Training load', tl.excluded ? 'not counted in fitness (gym excluded in settings)' : null].filter(Boolean).join(' - ')
  return (
    <span
      data-testid="calendar-tl"
      data-estimated={tl.estimated ? 'true' : 'false'}
      data-excluded={tl.excluded ? 'true' : 'false'}
      title={title}
      className={`rounded px-1 font-bold ${tl.estimated ? 'bg-emerald-600/60 text-white dark:bg-emerald-500/50 dark:text-emerald-50 ring-1 ring-inset ring-emerald-700/40' : 'bg-emerald-600 text-white dark:bg-emerald-500/90 dark:text-slate-900'} ${tl.excluded ? 'opacity-50 line-through decoration-1' : ''}`}
    >
      {label}
    </span>
  )
}

function EventChip({ event, race, returnTo, tl, tlHint }) {
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
            : event.discipline === 'gym'
              ? 'border-violet-300/70 dark:border-violet-500/40 bg-violet-500/5'
              : event.discipline === 'run'
                ? 'border-sky-300/70 dark:border-sky-500/40 bg-sky-500/5'
                : event.discipline === 'track'
                ? 'border-amber-300/70 dark:border-amber-500/40 bg-amber-500/5'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60'
      }`}
    >
      <ChipBody
        icon={race ? CALENDAR_ICONS.race : planned ? DISCIPLINE_ICON[event.discipline] || 'bike' : event.sportIcon || DISCIPLINE_ICON[event.discipline] || 'bike'}
        iconClass={race ? 'text-rose-500' : event.discipline === 'gym' ? 'text-violet-600 dark:text-violet-400' : event.discipline === 'run' ? 'text-sky-600 dark:text-sky-400' : event.discipline === 'track' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-brand-neon'}
        label={race ? `Race · ${race.priority}` : planned ? 'Planned' : activityChipLabel(event)}
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
        stats={[event.distanceM ? formatKm(event.distanceM) : null, event.durationS ? formatDuration(event.durationS) : null, event.metric?.label === 'TL' ? null : event.metric?.value, tl || tlHint ? <TlBadge key="tl" tl={tl} hint={tlHint} /> : null]}
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
      title={`${event.title} · ${PLANNED_STATUS_LABELS[event.status]}${event.pushState && event.pushState !== 'not_pushed' ? ` · ${PUSH_STATE_LABELS[event.pushState]}` : ''}${event.metric?.title ? ` · ${event.metric.title}` : ''}`}
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
        stats={[
          event.durationS ? formatDuration(event.durationS) : null,
          event.load != null ? (
            <span key="tl" data-testid="calendar-planned-tl" title={event.metric?.title || 'Planned training load (estimate)'} className="rounded px-1 font-bold border border-dashed border-sky-500/70 text-sky-700 dark:text-sky-300">
              {event.metric?.value} planned
            </span>
          ) : null,
        ]}
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
function RaceChip({ race, onOpen, form }) {
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
      {form && (
        <span className="block text-[10px] opacity-80" data-testid="calendar-race-form" data-status={form.status.key}>
          Projected form {form.form} · {form.status.label.split(' - ')[0].toLowerCase()}
        </span>
      )}
    </button>
  )
}

const tlHintFor = (e, opts) => {
  const r = unscoredReason(e, opts)
  return r ? UNSCORED_REASONS[r] : null
}

// Day total: past/completed days show completed TL only; today mixes done + remaining plan; future days show the plan.
function DayTl({ tl }) {
  if (!tl || tl.mode === 'none') return null
  const done = tl.mode !== 'planned'
  const plan = tl.plannedRemaining > 0
  return (
    <span className="mt-auto flex flex-wrap items-center justify-end gap-1 pt-0.5 text-[10px] font-bold" data-testid="day-tl" data-mode={tl.mode} title={done && plan ? 'Completed TL + remaining planned TL (estimate)' : done ? 'Completed training load' : 'Planned training load (estimate)'}>
      {done && (
        <span className="rounded px-1 bg-emerald-600 text-white dark:bg-emerald-500/90 dark:text-slate-900" data-testid="day-tl-completed" title={tl.estimated > 0 ? `${tl.measured} measured + ~${tl.estimated} estimated (heart rate or gym model)` : undefined}>
          TL {tl.completed}
          {tl.estimated > 0 && (
            <span className="ml-0.5 font-semibold opacity-80" data-testid="day-tl-estimated">({tl.measured} + ~{tl.estimated} est.)</span>
          )}
        </span>
      )}
      {tl.unscored > 0 && <span className="rounded px-1 font-semibold border border-slate-400/60 text-slate-500 dark:text-slate-400" data-testid="day-tl-unscored" title="Completed activities without TL (no HR data, too short or no LT2 HR)">{tl.unscored} no TL</span>}
      {done && plan && <span className="opacity-60">+</span>}
      {plan && <span className="rounded px-1 border border-dashed border-sky-500/70 text-sky-700 dark:text-sky-300">~TL {tl.plannedRemaining}{done ? '' : ' planned'}{tl.plannedRemainingUnknown ? '+' : ''}</span>}
    </span>
  )
}

// Planned vs done training load of the week, same style as the time bar. Planned = ~TL of every non-skipped
// workout (done ones as the target); "+" / note when some workouts have no estimate.
// Done-vs-planned bar. Scale = max(done, planned): a tick marks the plan, the excess is an extra "over" segment (amber,
// diagonal stripes in the other direction so it is not colour-only) and a "+N over" label. See overPlan() in calendarLoad.js.
function PlanBar({ done, planned, measured = done, partial = false, label, valueText, testId, overText }) {
  const o = overPlan(done, planned, { measured, partial })
  if (!(planned > 0)) return null
  return (
    <div className="relative" data-testid={testId} data-over={o.over ? 'true' : 'false'}>
      <div className="h-1.5 rounded-full bg-sky-500/20 overflow-hidden" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={o.fillPct} aria-valuetext={`${valueText}${o.over ? `, ${overText}` : ''}`}>
        <div className="h-full flex">
          <div className="h-full bg-emerald-500" style={{ width: `${o.measuredPct}%` }} />
          <div
            className="h-full bg-emerald-400/60 dark:bg-emerald-400/50"
            data-testid={`${testId}-estimated`}
            style={{ width: `${o.estimatedPct}%`, backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.55) 0 2px, transparent 2px 5px)' }}
          />
          {o.over && (
            <div
              className="h-full bg-amber-500 dark:bg-amber-400"
              data-testid={`${testId}-over`}
              style={{ width: `${o.overBarPct}%`, backgroundImage: 'repeating-linear-gradient(-45deg, rgba(0,0,0,0.35) 0 2px, transparent 2px 5px)' }}
            />
          )}
        </div>
      </div>
      {o.over && <span aria-hidden className="absolute -top-0.5 h-2.5 w-0.5 bg-slate-900 dark:bg-white rounded" style={{ left: `calc(${o.tickPct}% - 1px)` }} data-testid={`${testId}-tick`} />}
    </div>
  )
}

function overBadge(o, unit, testId) {
  if (!o.over) return null
  const text = o.partialPlan ? `+${Math.round(o.excess)}${unit} over` : `+${o.overPct}% over`
  return (
    <div className="text-[10px] font-bold text-left">
      <span className="inline-block whitespace-nowrap rounded px-1 bg-amber-500 text-slate-900 dark:bg-amber-400" data-testid={testId}>{text}</span>
    </div>
  )
}

// Planned vs done training load of the week, same style as the time bar. Planned = ~TL of every non-skipped
// workout (done ones as the target); "+" / note when some workouts have no estimate.
function PlannedLoad({ tl }) {
  if (!tl.hasPlanned && tl.completed === 0 && !(tl.unscored > 0)) return null
  const o = overPlan(tl.completed, tl.planned, { measured: tl.measured, partial: tl.plannedPartial })
  const overTxt = o.over ? (o.partialPlan ? `${Math.round(o.excess)} TL over the known plan (some workouts have no estimate)` : `${Math.round(o.excess)} TL (${o.overPct}%) over plan`) : ''
  const tip = `Completed TL ${tl.completed}${tl.estimated > 0 ? ` (${tl.measured} measured + ~${tl.estimated} estimated from heart rate or gym model, hatched)` : ''} vs planned ~TL (estimate)${overTxt ? `; ${overTxt}` : ''}${tl.excludedGym ? `; gym TL ${tl.excludedGym} not counted (excluded from fitness)` : ''}`
  return (
    <div className="col-span-3 lg:col-span-1 space-y-1" data-testid="week-tl" data-partial={tl.plannedPartial ? 'true' : 'false'} data-over={o.over ? 'true' : 'false'} title={tip}>
      <div className="text-[10px] font-bold text-center lg:text-left">
        <span className="text-emerald-700 dark:text-brand-neon">TL {tl.completed}{tl.estimated > 0 ? ` (${tl.measured} + ~${tl.estimated} est.)` : ''}</span>
        {tl.hasPlanned && (
          <span className="text-sky-700 dark:text-sky-300">
            {' '}/ planned {tl.planned > 0 ? `~${tl.planned}${tl.plannedPartial ? '+' : ''}` : 'unknown'}
            {tl.plannedPartial && tl.planned > 0 ? ' (some estimates missing)' : ''}
          </span>
        )}
      </div>
      <PlanBar done={tl.completed} planned={tl.planned} measured={tl.measured} partial={tl.plannedPartial} label="Done vs planned training load" valueText={`TL ${tl.completed} of ${tl.planned} planned`} overText={overTxt} testId="week-tl-bar" />
      {overBadge(o, ' TL', 'week-tl-over-label')}
      {tl.unscored > 0 && (
        <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400" data-testid="week-tl-unscored" title="Completed runs/rides without TL: no average HR, too short, or no LT2 HR in Physiology">
          {tl.unscored} {tl.unscored === 1 ? 'activity' : 'activities'} not scored
        </div>
      )}
    </div>
  )
}

// Planned vs done time of the week: "planned 8:00 h" (with "+" when some durations are unknown) and a thin progress bar.
function PlannedTime({ summary }) {
  const o = overPlan(summary.durationS, summary.plannedDurationS, { partial: summary.plannedPartial })
  const overTxt = o.over ? (o.partialPlan ? `${formatDuration(o.excess)} h over the known plan (some durations unknown)` : `${formatDuration(o.excess)} h (${o.overPct}%) over plan`) : ''
  return (
    <div className="col-span-3 lg:col-span-1 space-y-1" data-testid="week-planned-time" data-partial={summary.plannedPartial ? 'true' : 'false'} data-over={o.over ? 'true' : 'false'} title={overTxt || undefined}>
      <div className="text-[10px] font-bold text-sky-700 dark:text-sky-300 text-center lg:text-left">
        {summary.plannedDurationS > 0
          ? `planned ${formatDuration(summary.plannedDurationS)} h${summary.plannedPartial ? '+' : ''}`
          : 'planned time unknown'}
        {summary.plannedPartial && summary.plannedDurationS > 0 ? ' (some durations unknown)' : ''}
      </div>
      <PlanBar done={summary.durationS} planned={summary.plannedDurationS} partial={summary.plannedPartial} label="Done vs planned time" valueText={`${formatDuration(summary.durationS)} h of ${formatDuration(summary.plannedDurationS)} h planned`} overText={overTxt} testId="week-time-bar" />
      {o.over && (
        <div className="text-[10px] font-bold text-left">
          <span className="inline-block whitespace-nowrap rounded px-1 bg-amber-500 text-slate-900 dark:bg-amber-400" data-testid="week-time-over-label" title={o.partialPlan ? 'Over the known part of the plan; some workouts have no estimate' : undefined}>{o.partialPlan ? `+${formatDuration(o.excess)} h over` : `+${o.overPct}% over`}</span>
        </div>
      )}
    </div>
  )
}

// Totals of the displayed month for the calendar header (only the month's own days, see monthTotals()).
function MonthSummary({ rows }) {
  const t = useMemo(() => monthTotals(rows), [rows])
  const [open, setOpen] = useState(false)
  if (t.count === 0 && t.planned.count === 0) return null
  const tlO = overPlan(t.tl.completed, t.planned.load, { measured: t.tl.measured, partial: t.planned.loadPartial })
  const timeO = overPlan(t.durationS, t.planned.durationS, { partial: t.planned.durationPartial })
  const types = [['ride', 'ride'], ['run', 'run'], ['gym', 'gym']].filter(([k]) => t.byDiscipline[k] > 0).map(([k, l]) => `${t.byDiscipline[k]} ${l}`).join(' · ')
  const chip = 'rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:text-slate-200'
  const overChip = (o, unit) => o.over && <span title={o.partialPlan ? 'Over the known part of the plan; some workouts have no estimate' : undefined} className="rounded px-1 bg-amber-500 text-slate-900 dark:bg-amber-400">{o.partialPlan ? `+${unit(o.excess)} over` : `+${o.overPct}% over`}</span>
  const tlText = `TL ${t.tl.completed}${t.tl.estimated > 0 ? ` (${t.tl.measured} + ~${t.tl.estimated} est.)` : ''}`
  const tlTip = `Completed TL of the month ${t.tl.completed}${t.tl.estimated > 0 ? ` (${t.tl.measured} measured + ~${t.tl.estimated} estimated)` : ''}; projected with the remaining plan ~${t.tl.projected}${t.tl.unscored ? `; ${t.tl.unscored} not scored` : ''}`
  return (
    <div data-testid="month-summary" className="flex flex-wrap items-center justify-center gap-1.5 text-[11px]" aria-label="Month summary">
      <span className={`${chip} text-emerald-700 dark:text-brand-neon`} data-testid="month-time">{formatDuration(t.durationS)} h</span>
      <span className={`${chip} hidden sm:inline`}>{formatKm(t.distanceM)}</span>
      <span className={chip} data-testid="month-count">{t.count} {t.count === 1 ? 'activity' : 'activities'}</span>
      <button type="button" className={`${chip} sm:hidden`} aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="month-summary-toggle">{open ? 'Less' : 'More'}</button>
      <div className={`${open ? 'flex' : 'hidden sm:flex'} flex-wrap items-center justify-center gap-1.5 basis-full sm:basis-auto`} data-testid="month-summary-more">
        <span className={`${chip} sm:hidden`}>{formatKm(t.distanceM)}</span>
        {t.tl.completed > 0 && <span className={`${chip} text-emerald-700 dark:text-brand-neon`} title={tlTip} data-testid="month-tl">{tlText}</span>}
        {types && <span className={chip} data-testid="month-types">{types}</span>}
        {t.planned.durationS > 0 && (
          <span className={`${chip} text-sky-700 dark:text-sky-300`} data-testid="month-planned-time" data-over={timeO.over ? 'true' : 'false'} title={`Done ${formatDuration(t.durationS)} h of ${formatDuration(t.planned.durationS)} h planned this month`}>
            time {formatDuration(t.durationS)} / {formatDuration(t.planned.durationS)} h{t.planned.durationPartial ? '+' : ''} {overChip(timeO, (v) => `${formatDuration(v)} h`)}
          </span>
        )}
        {t.planned.load > 0 && (
          <span className={`${chip} text-sky-700 dark:text-sky-300`} data-testid="month-planned-tl" data-over={tlO.over ? 'true' : 'false'} title={`Completed TL ${t.tl.completed} of ~${t.planned.load} planned this month`}>
            TL {t.tl.completed} / ~{t.planned.load}{t.planned.loadPartial ? '+' : ''} {overChip(tlO, (v) => `${Math.round(v)} TL`)}
          </span>
        )}
      </div>
      {(t.planned.durationS > 0 || t.planned.load > 0) && (
        <div className="basis-full grid grid-cols-2 gap-2 max-w-md mx-auto w-full">
          {t.planned.durationS > 0 ? <PlanBar done={t.durationS} planned={t.planned.durationS} partial={t.planned.durationPartial} label="Month: done vs planned time" valueText={`${formatDuration(t.durationS)} h of ${formatDuration(t.planned.durationS)} h planned`} overText={timeO.over ? `${formatDuration(timeO.excess)} h over` : ''} testId="month-time-bar" /> : <span />}
          {t.planned.load > 0 ? <PlanBar done={t.tl.completed} planned={t.planned.load} measured={t.tl.measured} partial={t.planned.loadPartial} label="Month: done vs planned training load" valueText={`TL ${t.tl.completed} of ${t.planned.load} planned`} overText={tlO.over ? `${Math.round(tlO.excess)} TL over` : ''} testId="month-tl-bar" /> : <span />}
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
      {summary.tl && <PlannedLoad tl={summary.tl} />}
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
const EMPTY = []

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
  const pendingTodayScroll = useRef(true)
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
  const loadContext = useRiderLoadContext(riderId)
  // The rider's "include gym in fitness" choice (default on). Gym TL stays visible when off, but is dimmed and not counted.
  const [includeGym, setIncludeGym] = useState(true)
  useEffect(() => {
    if (!riderId) return undefined
    let cancelled = false
    supabase.from('profiles').select('include_gym_in_fitness').eq('id', riderId).maybeSingle()
      .then(({ data }) => !cancelled && setIncludeGym(data?.include_gym_in_fitness !== false))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [riderId])
  const ftpHistory = loadContext?.ftpHistory || EMPTY
  const rows = useMemo(() => {
    const today = new Date()
    const base = buildCalendarRows(buildMonthGrid(anchor), [...events, ...planned.map((w) => ({ ...plannedToEvent(w, today, loadContext), pushState: pushState(w, pushRows.get(w.id)) }))], { anchor, notes, races })
    return addLoadToRows(base, { today, ltHistory: loadContext?.ltHistory || EMPTY, includeGym })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, events, notes, races, planned, pushRows, todayKey, loadContext, includeGym])
  const raceForms = useRaceForms(riderId, races, { coach: Boolean(riderIdProp && riderIdProp !== sessionUserId), loadContext })
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

  // One-shot: runs after the month finishes loading, never on later re-renders (edits, drag-and-drop).
  useEffect(() => {
    if (loading || !pendingTodayScroll.current || !shouldAutoScrollToToday(anchor, new Date())) return
    pendingTodayScroll.current = false
    const el = document.querySelector('[data-today="true"]')
    if (!el) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: todayScrollBehavior(reduced) })
  }, [loading, anchor])

  const goToMonth = (a, scrollToToday) => {
    pendingTodayScroll.current = scrollToToday
    setAnchor(a)
  }

  const title = formatDate(anchor, { month: 'long', year: 'numeric' })

  const weekdayLabels = rows[0]?.cells.map((c) => formatDate(c.date, { weekday: 'short' })) || []
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 hover:border-emerald-500 transition'

  return (
    <div className="glass-card bg-white dark:bg-surface-darkCard p-3 sm:p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
      <div data-testid="calendar-sticky-header" className="lg:sticky lg:top-[4.25rem] lg:z-20 lg:-mx-5 lg:-mt-5 lg:px-5 lg:pt-4 lg:pb-2 lg:rounded-t-2xl glass-dense lg:bg-white dark:lg:bg-surface-darkCard lg:border-b lg:border-slate-200 dark:lg:border-surface-darkBorder lg:shadow-sm space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button aria-label="Previous" className={btn} onClick={() => goToMonth(shiftMonth(anchor, -1), false)}>‹</button>
          <button className={btn} onClick={() => goToMonth(startOfDay(new Date()), true)}>Today</button>
          <button aria-label="Next" className={btn} onClick={() => goToMonth(shiftMonth(anchor, 1), false)}>›</button>
        </div>
        <h2 className="text-base font-extrabold text-slate-900 dark:text-white capitalize">{title}</h2>
        <span className="hidden sm:block w-[7.5rem]" aria-hidden />
      </div>
      <MonthSummary rows={rows} />
      <div className="hidden lg:grid grid-cols-[repeat(7,minmax(0,1fr))_9rem] gap-1.5 text-[10px] uppercase tracking-widest font-bold text-slate-400">
        {weekdayLabels.map((l, i) => <div key={i} className="px-1">{l}</div>)}
        <div className="px-1">Week total</div>
      </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-semibold">{error}</div>
      )}

      <div className={`space-y-2 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
        {rows.map((row, ri) => (
          <div key={ri} className="grid grid-cols-1 lg:grid-cols-[repeat(7,minmax(0,1fr))_9rem] gap-1.5">
            {row.cells.map((cell) => {
              const hideOnMobile = !isShownOnMobile(cell)
              const slimOnMobile = isEmptyDay(cell)
              return (
                <div
                  key={cell.key}
                  data-today={cell.isToday ? 'true' : undefined}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => dropOnDay(e, cell.date)}
                  className={`scroll-mt-24 lg:scroll-mt-44 rounded-xl border p-1.5 ${slimOnMobile ? 'min-h-[1.75rem] py-0.5 opacity-80 lg:py-1.5 lg:opacity-100' : 'min-h-[3rem]'} lg:min-h-[6.5rem] flex flex-col gap-1 ${hideOnMobile ? 'hidden lg:flex' : ''} ${
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
                  {cell.races.map((r) => <RaceChip key={r.id} race={r} form={raceForms.get(r.id)} onOpen={(race) => setRdialog({ day: cell.date, race })} />)}
                  {cell.events.map((e) => (e.kind === 'planned'
                    ? <PlannedChip key={`planned-${e.id}`} event={e} onOpen={(id) => openPlanned(cell.date, id)} />
                    : <EventChip key={`${e.kind}-${e.id}`} event={e} race={raceByActivity.get(e.id)} returnTo={returnTo} tl={completedEventLoad(e, { ltHistory: loadContext?.ltHistory || EMPTY, includeGym })} tlHint={tlHintFor(e, { ltHistory: loadContext?.ltHistory || EMPTY })} />))}
                  <DayTl tl={cell.tl} />
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
            loadContext={loadContext}
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
