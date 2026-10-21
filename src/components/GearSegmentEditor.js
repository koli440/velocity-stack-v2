'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { assignSegment, summarizeSegments } from '../lib/gearSegments'
import { gearLabel } from '../lib/gear'
import { formatElapsed } from '../lib/format'

// One colour per gear position (primary first).
export const GEAR_COLORS = ['#10b981', '#f97316', '#38bdf8', '#a855f7', '#eab308', '#ef4444', '#14b8a6', '#ec4899']
const colorFor = (gears, id) => GEAR_COLORS[Math.max(0, gears.findIndex((g) => g.id === id)) % GEAR_COLORS.length]

const CHART_W = 1000
const CHART_H = 100

function line(values, total, color) {
  const v = (values || []).map((x) => (Number.isFinite(x) ? x : 0))
  const max = Math.max(...v, 1)
  if (v.length < 2) return null
  const pts = v.map((x, i) => `${((i / Math.max(total, 1)) * CHART_W).toFixed(1)},${(CHART_H - (x / max) * (CHART_H - 4) - 2).toFixed(1)}`)
  return <polyline key={color} points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" opacity="0.8" />
}

const thumb =
  'absolute inset-x-0 top-0 h-full w-full appearance-none bg-transparent pointer-events-none focus:outline-none ' +
  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-9 [&::-webkit-slider-thumb]:w-6 ' +
  '[&::-webkit-slider-thumb]:rounded-md [&::-webkit-slider-thumb]:bg-slate-900 dark:[&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-orange-500 [&::-webkit-slider-thumb]:cursor-ew-resize ' +
  '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-9 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-md [&::-moz-range-thumb]:bg-slate-900 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-orange-500 ' +
  'focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-orange-400'

/**
 * Assigns gears to elapsed-time ranges of a ride (issue #279). A range slider with two large
 * touch handles (arrow keys nudge by 1 s, PageUp/PageDown by more) sits over a chart of power,
 * cadence and speed. Unassigned time uses the primary (first) gear.
 */
export default function GearSegmentEditor({ totalS, gears, segments, onChange, series = {}, disabled = false }) {
  const uid = useId()
  const total = Math.max(0, Math.floor(totalS || 0))
  const [range, setRange] = useState({ start: 0, end: total })
  useEffect(() => setRange({ start: 0, end: total }), [total])

  const summary = useMemo(() => summarizeSegments(total, gears, segments, series), [total, gears, segments, series])

  if (!gears?.length || total < 2) return null
  const primaryId = gears[0].id
  const setStart = (v) => setRange((r) => ({ start: Math.min(Math.max(0, v), r.end - 1), end: r.end }))
  const setEnd = (v) => setRange((r) => ({ start: r.start, end: Math.max(Math.min(total, v), r.start + 1) }))
  const pct = (s) => `${(s / total) * 100}%`

  return (
    <div className="space-y-3" data-testid="gear-segment-editor">
      <div>
        <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">Gear by time segment</p>
        <p className="text-[11px] text-slate-400">
          Drag the handles (or focus one and use the arrow keys) to select a time range, then pick the gear used. Time not assigned uses the first gear.
        </p>
      </div>

      <div className="relative h-24 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        {summary.map((r) => (
          <div
            key={`${r.start_s}-${r.end_s}`}
            className="absolute top-0 h-full"
            style={{ left: pct(r.start_s), width: pct(r.end_s - r.start_s), background: colorFor(gears, r.gear_id), opacity: r.assigned ? 0.28 : 0.1 }}
          />
        ))}
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
          {line(series.watts, total, '#a855f7')}
          {line(series.cadence, total, '#f97316')}
          {line(series.speed, total, '#38bdf8')}
        </svg>
        <div className="absolute top-0 h-full border-x-2 border-orange-500 bg-orange-500/15" style={{ left: pct(range.start), width: pct(range.end - range.start) }} />
      </div>

      <div className="relative h-9 touch-none">
        <input
          type="range"
          aria-label="Segment start"
          min={0}
          max={total}
          step={1}
          value={range.start}
          disabled={disabled}
          onChange={(e) => setStart(Number(e.target.value))}
          className={thumb}
        />
        <input
          type="range"
          aria-label="Segment end"
          min={0}
          max={total}
          step={1}
          value={range.end}
          disabled={disabled}
          onChange={(e) => setEnd(Number(e.target.value))}
          className={thumb}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono font-bold text-slate-700 dark:text-slate-200">
        <span>Start {formatElapsed(range.start)}</span>
        <span>End {formatElapsed(range.end)}</span>
        <span className="text-slate-400">({range.end - range.start} s)</span>
        <span className="flex gap-2 text-[10px] text-slate-400 font-sans">
          <span style={{ color: '#a855f7' }}>Power</span>
          <span style={{ color: '#f97316' }}>Cadence</span>
          <span style={{ color: '#38bdf8' }}>Speed</span>
        </span>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${uid}-assign`}>
        <span id={`${uid}-assign`} className="sr-only">Assign selected range to gear</span>
        {gears.map((g, i) => (
          <button
            key={g.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(assignSegment(segments, range.start, range.end, g.id, primaryId))}
            className="min-h-[40px] px-3 rounded-xl border text-xs font-bold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 disabled:opacity-50"
            style={{ borderColor: GEAR_COLORS[i % GEAR_COLORS.length] }}
          >
            Assign {gearLabel(g.chainring, g.cog)}{i === 0 ? ' (primary)' : ''}
          </button>
        ))}
        {segments.length > 0 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([])}
            className="min-h-[40px] px-3 rounded-xl text-xs font-bold text-slate-500 border border-slate-200 dark:border-slate-700"
          >
            Clear segments
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase text-slate-400">
              <th className="py-1 pr-3">Gear</th>
              <th className="pr-3">Time</th>
              <th className="pr-3">Duration</th>
              <th className="pr-3">Avg power</th>
              <th className="pr-3">Cadence</th>
              <th>Speed</th>
            </tr>
          </thead>
          <tbody className="font-mono text-slate-700 dark:text-slate-200">
            {summary.map((r) => (
              <tr key={`${r.start_s}-${r.end_s}`} className="border-t border-slate-100 dark:border-slate-800/60">
                <td className="py-1 pr-3 font-bold">
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colorFor(gears, r.gear_id) }} />
                  {r.label}
                  {r.note ? <span className="font-sans font-normal text-slate-400"> · {r.note}</span> : null}
                </td>
                <td className="pr-3">{formatElapsed(r.start_s)}–{formatElapsed(r.end_s)}</td>
                <td className="pr-3">{formatElapsed(r.duration_s)}</td>
                <td className="pr-3">{r.avg_power != null ? `${Math.round(r.avg_power)} W` : '—'}</td>
                <td className="pr-3">{r.avg_cadence != null ? `${Math.round(r.avg_cadence)} rpm` : '—'}</td>
                <td>{r.avg_speed != null ? `${r.avg_speed.toFixed(1)} km/h` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
