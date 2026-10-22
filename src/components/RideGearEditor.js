'use client'

import { useId, useMemo } from 'react'
import Icon from './Icon'
import GearPicker from './GearPicker'
import GearSegmentEditor from './GearSegmentEditor'
import { GEAR_COLORS } from './GearSegmentEditor'
import { RIDE_TYPES, effectiveRideType, rideTypeHasGear } from '../lib/rideType'
import { MAX_GEARS, MAX_NOTE_LENGTH, moveGear, nextGearId, removeGear, toGearPayload } from '../lib/gearSegments'

const inputClass =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-orange-500'
const labelClass = 'block text-[10px] uppercase font-bold text-slate-400 mb-1'
const iconBtn =
  'min-h-[40px] min-w-[40px] px-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-40'

/** Elapsed seconds and 1 Hz series of an activity's time series, for the segment editor. */
export function segmentSeriesOf(timeSeries) {
  const ts = timeSeries || {}
  const len = Math.max(...['watts', 'cadence', 'speed'].map((k) => (Array.isArray(ts[k]) ? ts[k].length : 0)), 0)
  return { totalS: len > 1 ? len - 1 : 0, series: { watts: ts.watts, cadence: ts.cadence, speed: ts.speed } }
}

/**
 * Ride type select plus, for ride types with gear (track), the multi-gear list (add / remove /
 * reorder / notes) and the time-segment editor. Controlled; used by the edit modal, the activity
 * page and the coach editor. The first gear is the primary gear.
 */
export default function RideGearEditor({
  rideType,
  onRideTypeChange,
  gears,
  onGearsChange,
  segments,
  onSegmentsChange,
  timeSeries,
  disabled = false,
  showSegments = true,
}) {
  const uid = useId()
  const type = effectiveRideType(rideType)
  const hasGear = rideTypeHasGear(type)
  const known = RIDE_TYPES.some((t) => t.key === type)
  const payload = useMemo(() => toGearPayload(gears), [gears])
  const { totalS, series } = useMemo(() => segmentSeriesOf(timeSeries), [timeSeries])
  const allValid = payload.length === gears.length

  const update = (id, patch) => onGearsChange(gears.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  const add = () => onGearsChange([...gears, { id: nextGearId(gears), chainring: '', cog: '', note: '' }])
  const remove = (id) => {
    const r = removeGear(gears, segments, id)
    onGearsChange(r.gears)
    onSegmentsChange(r.segments)
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass} htmlFor={`${uid}-type`}>Ride type</label>
        <select
          id={`${uid}-type`}
          value={type}
          disabled={disabled}
          onChange={(e) => onRideTypeChange(e.target.value)}
          className={inputClass}
        >
          {RIDE_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
          {!known && <option value={type}>{type}</option>}
        </select>
        {!hasGear && gears.length > 0 && (
          <p className="mt-1 text-[11px] text-slate-400">Stored gear is kept and shown again if you switch back to Track.</p>
        )}
      </div>

      {hasGear && (
        <div className="space-y-3">
          <p className={labelClass}>Gears (optional) · the first one is the primary gear</p>
          {gears.length === 0 && <p className="text-[11px] text-slate-400">No gear set.</p>}
          {gears.map((g, i) => (
            <div
              key={g.id}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2"
              style={{ borderLeft: `4px solid ${GEAR_COLORS[i % GEAR_COLORS.length]}` }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-500">{i === 0 ? 'Primary gear' : `Gear ${i + 1}`}</span>
                <div className="flex gap-1.5">
                  <button type="button" aria-label="Move gear up" disabled={disabled || i === 0} onClick={() => onGearsChange(moveGear(gears, g.id, -1))} className={iconBtn}>↑</button>
                  <button type="button" aria-label="Move gear down" disabled={disabled || i === gears.length - 1} onClick={() => onGearsChange(moveGear(gears, g.id, 1))} className={iconBtn}>↓</button>
                  <button type="button" aria-label="Remove gear" disabled={disabled} onClick={() => remove(g.id)} className={`${iconBtn} text-rose-500`}><Icon name="close" size="1em" /></button>
                </div>
              </div>
              <GearPicker
                label={i === 0 ? 'Gear' : `Gear ${i + 1}`}
                chainring={g.chainring}
                cog={g.cog}
                onChange={(v) => update(g.id, v)}
                showStats
                disabled={disabled}
              />
              <input
                value={g.note || ''}
                maxLength={MAX_NOTE_LENGTH}
                disabled={disabled}
                onChange={(e) => update(g.id, { note: e.target.value })}
                placeholder="Note (optional), e.g. warm-up gear"
                aria-label={`Note for gear ${i + 1}`}
                className={inputClass}
              />
            </div>
          ))}
          <button type="button" onClick={add} disabled={disabled || gears.length >= MAX_GEARS} className="min-h-[40px] px-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-40">
            + Add gear
          </button>

          {showSegments && allValid && payload.length > 1 && totalS > 1 && (
            <GearSegmentEditor totalS={totalS} gears={payload} segments={segments} onChange={onSegmentsChange} series={series} disabled={disabled} />
          )}
          {showSegments && payload.length === 1 && totalS > 1 && (
            <p className="text-[11px] text-slate-400">Add a second gear to assign gears to time segments.</p>
          )}
        </div>
      )}
    </div>
  )
}
