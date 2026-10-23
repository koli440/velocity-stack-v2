'use client'

// Activity stream graphs (issue #12): speed, heart rate, power, cadence and torque, each in its
// own compact lane, stacked vertically and aligned on a shared X axis that can be switched
// between elapsed time and distance.
//
// `highlightWindows` (issue #14 — Template Creator) lets the activity page overlay the
// work/recovery intervals matched by the latest template execution directly on these
// charts, tinted by role and kept in sync across lanes via the shared `syncId`.

import { useMemo, useRef, useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from 'recharts'
import { ltFromActivity } from '../lib/lactateThresholds'
import { zoneRanges, zonesFromActivity } from '../lib/powerZones'
import { resolveSelection, sliceRange, zoomBy, panBy } from '../lib/chartZoom'
import Icon from './Icon'
import Portal from './Portal'
import useModalA11y from './useModalA11y'
import { STREAM_METRICS, buildStreamSeries, formatAxisTick, formatElapsed } from '../lib/activityStreams'

// Lactate threshold lines (issue #121) drawn on the power and heart-rate lanes.
function thresholdLines(metric, lt) {
  if (!lt) return []
  if (metric.key === 'watts') return [['LT1', lt.lt1Power], ['LT2', lt.lt2Power]].filter(([, v]) => v != null)
  if (metric.key === 'heartrate') return [['LT1', lt.lt1Hr], ['LT2', lt.lt2Hr]].filter(([, v]) => v != null)
  return []
}

// Power zone bands (issue #194) behind the power lane; Z1 and Z6 are open-ended and clipped to the data.
const ZONE_COLORS = ['#94a3b8', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7']

function zoneBands(metric, zones, data) {
  if (!zones || metric.key !== 'watts') return []
  const peak = data.reduce((m, d) => (d.watts != null && d.watts > m ? d.watts : m), 0)
  const top = Math.max(peak, zones.bounds[zones.bounds.length - 1] + 1)
  return zoneRanges(zones).map((r) => ({ label: r.label, y1: r.minW ?? 0, y2: r.maxW ?? top, color: ZONE_COLORS[r.zone - 1] }))
}

function MetricLane({ metric, data, mode, syncId, highlightWindows, lt, zones, zoom, laneHeight, idSuffix = '' }) {
  const hasData = data.some((d) => d[metric.key] != null)
  if (!hasData) return null
  const lines = thresholdLines(metric, lt)
  const bands = zoneBands(metric, zones, data)
  const lineValues = lines.map(([, v]) => v)
  const yDomain = lineValues.length
    ? [(min) => Math.min(min, ...lineValues), (max) => Math.max(max, ...lineValues)]
    : ['auto', 'auto']

  return (
    <div className="flex items-center gap-3">
      <div className="w-16 shrink-0 text-right">
        <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {metric.label}
        </div>
        <div className="text-[9px] text-slate-400">{metric.unit}</div>
      </div>
      <div className="flex-1 min-w-0" style={{ height: laneHeight || 48 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} syncId={syncId} margin={{ top: 2, right: 4, left: 4, bottom: 0 }}>
            {mode === 'time' &&
              highlightWindows.map((w, idx) => (
                <ReferenceArea
                  key={`${w.role}-${w.start_sec}-${idx}`}
                  x1={w.start_sec}
                  x2={w.end_sec}
                  fill={w.color || (w.role === 'recovery' ? '#3b82f6' : '#f97316')}
                  fillOpacity={0.18}
                  stroke="none"
                  ifOverflow={zoom ? 'hidden' : 'visible'}
                />
              ))}
            {bands.map((b) => (
              <ReferenceArea key={b.label} y1={b.y1} y2={b.y2} fill={b.color} fillOpacity={0.08} stroke="none" ifOverflow="hidden" />
            ))}
            <defs>
              <linearGradient id={`fill-${metric.key}${idSuffix}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={metric.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={metric.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {/* type="number" + explicit domain so points are placed by their real x value
                (seconds or meters), not evenly spaced by array index. Without this, Recharts
                falls back to a category axis and the time/distance switch has no visual effect:
                stationary stretches (repeated distance values) still take up as much horizontal
                space as they do in time mode. */}
            <XAxis dataKey="x" type="number" domain={zoom || ['dataMin', 'dataMax']} allowDataOverflow hide />
            <YAxis hide domain={yDomain} />
            {lines.map(([name, value]) => (
              <ReferenceLine
                key={name}
                y={value}
                stroke={name === 'LT1' ? '#22c55e' : '#f43f5e'}
                strokeDasharray="4 3"
                strokeWidth={1}
                ifOverflow="extendDomain"
                label={{ value: `${name} ${value}`, position: 'insideTopRight', fontSize: 8, fill: '#94a3b8' }}
              />
            ))}
            <Tooltip
              cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null
                const value = payload[0]?.value
                if (value == null) return null
                return (
                  <div className="bg-slate-900 text-white text-[10px] py-1.5 px-2.5 rounded-lg shadow-lg border border-slate-800 whitespace-nowrap">
                    <span className="text-slate-400">{formatAxisTick(label, mode)} · </span>
                    <span className="font-black" style={{ color: metric.color }}>
                      {metric.decimals > 0 ? value.toFixed(metric.decimals) : Math.round(value)} {metric.unit}
                    </span>
                  </div>
                )
              }}
            />
            <Area
              type="monotone"
              dataKey={metric.key}
              stroke={metric.color}
              strokeWidth={1.5}
              fill={`url(#fill-${metric.key}${idSuffix})`}
              isAnimationActive={false}
              connectNulls
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

const ZOOM_STEP = 1.5
const PAN_STEP = 0.25

const iconBtn = 'inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

function ChartPanel({ data, mode, zoom, setZoom, highlightWindows, lt, zones, enlarged, idSuffix }) {
  const [drag, setDrag] = useState(null) // { startPx, endPx } relative to the plot area
  const plotRef = useRef(null)
  const dragRef = useRef(null)

  const fullDomain = [data[0].x, data[data.length - 1].x]
  const viewDomain = zoom || fullDomain
  const viewData = useMemo(() => sliceRange(data, zoom), [data, zoom])
  const laneHeight = enlarged ? 'max(64px, calc((100dvh - 15rem) / 5))' : 48

  const plotMetrics = (e) => {
    const rect = plotRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { rect, px: e.clientX - rect.left, width: rect.width }
  }
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const m = plotMetrics(e)
    if (!m || m.px < -4 || m.px > m.width + 4) return
    dragRef.current = { startPx: m.px, endPx: m.px, id: e.pointerId }
    setDrag({ startPx: m.px, endPx: m.px })
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    const m = plotMetrics(e)
    if (!m) return
    d.endPx = m.px
    setDrag({ startPx: d.startPx, endPx: m.px })
  }
  const endDrag = (e, cancelled) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    dragRef.current = null
    setDrag(null)
    if (cancelled) return
    const m = plotMetrics(e)
    const res = resolveSelection({ startPx: d.startPx, endPx: m ? m.px : d.endPx, width: m ? m.width : 0, domain: viewDomain, zoomed: !!zoom })
    if (res.type === 'zoom') setZoom(res.range)
    else if (res.type === 'reset') setZoom(null)
  }

  const zoomIn = () => setZoom(zoomBy(zoom, fullDomain, ZOOM_STEP))
  const zoomOut = () => setZoom(zoomBy(zoom, fullDomain, 1 / ZOOM_STEP))
  const pan = (f) => setZoom(panBy(zoom, fullDomain, f))
  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    let handled = true
    if (e.key === 'ArrowLeft') pan(-PAN_STEP)
    else if (e.key === 'ArrowRight') pan(PAN_STEP)
    else if (e.key === '+' || e.key === '=') zoomIn()
    else if (e.key === '-' || e.key === '_') zoomOut()
    else if (e.key === '0') setZoom(null)
    else handled = false
    if (handled) e.preventDefault()
  }

  return (
    <>
      {enlarged && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2" role="toolbar" aria-label="Chart zoom controls">
          <button type="button" className={iconBtn} onClick={() => pan(-PAN_STEP)} disabled={!zoom} aria-label="Pan left" title="Pan left (←)"><Icon name="chevronLeft" size={16} /></button>
          <button type="button" className={iconBtn} onClick={() => pan(PAN_STEP)} disabled={!zoom} aria-label="Pan right" title="Pan right (→)"><Icon name="chevronRight" size={16} /></button>
          <button type="button" className={iconBtn} onClick={zoomOut} disabled={!zoom} aria-label="Zoom out" title="Zoom out (-)"><Icon name="zoomOut" size={16} /></button>
          <button type="button" className={iconBtn} onClick={zoomIn} aria-label="Zoom in" title="Zoom in (+)"><Icon name="zoomIn" size={16} /></button>
          <button type="button" onClick={() => setZoom(null)} disabled={!zoom} className="h-8 px-3 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
            Reset zoom
          </button>
          {zoom && (
            <span className="ml-1 text-[11px] font-bold text-orange-500">
              {formatAxisTick(zoom[0], mode)} – {formatAxisTick(zoom[1], mode)}
            </span>
          )}
        </div>
      )}
      <div
        className="relative space-y-1.5 select-none cursor-crosshair rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        style={{ touchAction: enlarged ? 'none' : 'pan-y' }}
        tabIndex={enlarged ? 0 : undefined}
        role={enlarged ? 'group' : undefined}
        aria-label={enlarged ? 'Activity graph. Arrow keys pan, plus and minus zoom, 0 resets zoom.' : undefined}
        onKeyDown={enlarged ? onKeyDown : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
      >
        <div ref={plotRef} className="absolute inset-y-0 pointer-events-none" style={{ left: 'calc(4.75rem + 4px)', right: 4 }}>
          {drag && Math.abs(drag.endPx - drag.startPx) >= 1 && (
            <div
              className="absolute inset-y-0 bg-orange-500/20 border-x border-orange-500/60 z-10"
              style={{ left: Math.min(drag.startPx, drag.endPx), width: Math.abs(drag.endPx - drag.startPx) }}
            />
          )}
        </div>
        {STREAM_METRICS.map((metric) => (
          <MetricLane key={metric.key} metric={metric} data={viewData} zoom={zoom} mode={mode} syncId={`activity-streams${idSuffix}`} highlightWindows={highlightWindows} lt={lt} zones={zones} laneHeight={laneHeight} idSuffix={idSuffix} />
        ))}
      </div>

      <div className="mt-2 pl-[4.75rem] flex justify-between text-[9px] font-semibold text-slate-400">
        <span>{formatAxisTick(viewDomain[0], mode)}</span>
        <span className="text-slate-400/80 font-medium">
          {enlarged ? 'Drag to zoom · arrows pan · +/- zoom · 0 reset' : 'Drag to zoom · click to reset'}
        </span>
        <span>{formatAxisTick(viewDomain[1], mode)}</span>
      </div>
    </>
  )
}

function EnlargedDialog({ onClose, title, children }) {
  const dialogRef = useModalA11y(true, onClose)
  return (
    <Portal>
      <div className="fixed inset-0 z-[100] bg-black/60 sm:p-4 flex items-stretch sm:items-center justify-center">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="activity-graph-enlarged-title"
          tabIndex={-1}
          className="w-full h-full sm:h-auto sm:max-h-full sm:max-w-[96vw] overflow-y-auto bg-white dark:bg-surface-darkCard sm:rounded-3xl p-4 sm:p-5 shadow-2xl focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <h2 id="activity-graph-enlarged-title" className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {title}
            </h2>
            <button type="button" data-autofocus onClick={onClose} aria-label="Close enlarged graph" className={iconBtn}>
              <Icon name="close" size={16} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </Portal>
  )
}

export default function ActivityStreamsChart({ timeSeries = {}, highlightWindows = [], activity = null }) {
  const lt = useMemo(() => ltFromActivity(activity), [activity])
  const zones = useMemo(() => zonesFromActivity(activity, lt), [activity, lt])
  const [mode, setMode] = useState('time')
  // zoom = [x1, x2] in the current axis unit (null = full view); shared by inline and enlarged panels.
  const [zoom, setZoom] = useState(null)
  const [enlarged, setEnlarged] = useState(false)

  const switchMode = (next) => {
    setMode(next)
    setZoom(null)
  }

  const data = useMemo(() => buildStreamSeries(timeSeries, mode), [timeSeries, mode])
  if (data.length === 0) return null

  const lastPoint = data[data.length - 1]
  const modeSwitch = (
    <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900/60 rounded-xl border border-slate-200/60 dark:border-slate-800">
      {[
        { key: 'time', label: 'Time' },
        { key: 'distance', label: 'Distance' },
      ].map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => switchMode(opt.key)}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
            mode === opt.key
              ? 'bg-orange-500 text-white shadow-xs'
              : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
  const panelProps = { data, mode, zoom, setZoom, highlightWindows, lt, zones }

  return (
    <div className="glass-dense w-full bg-white dark:bg-surface-darkCard p-4 sm:p-5 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
            Activity Graph
          </h2>
          <p className="text-[10px] text-slate-400">
            {mode === 'time' ? `Elapsed ${formatElapsed(lastPoint.x)}` : `Distance ${(lastPoint.x / 1000).toFixed(2)} km`}
            {zoom && (
              <span className="ml-2 font-bold text-orange-500">
                Zoomed {formatAxisTick(zoom[0], mode)} – {formatAxisTick(zoom[1], mode)}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {modeSwitch}
          <button type="button" className={iconBtn} onClick={() => setEnlarged(true)} aria-label="Enlarge activity graph" title="Enlarge">
            <Icon name="expand" size={16} />
          </button>
        </div>
      </div>

      <ChartPanel {...panelProps} idSuffix="" />

      {enlarged && (
        <EnlargedDialog onClose={() => setEnlarged(false)} title="Activity Graph">
          <div className="flex justify-between items-center gap-3 mb-3">
            <p className="text-[11px] text-slate-400">
              {mode === 'time' ? `Elapsed ${formatElapsed(lastPoint.x)}` : `Distance ${(lastPoint.x / 1000).toFixed(2)} km`}
            </p>
            {modeSwitch}
          </div>
          <ChartPanel {...panelProps} enlarged idSuffix="-large" />
        </EnlargedDialog>
      )}
    </div>
  )
}
