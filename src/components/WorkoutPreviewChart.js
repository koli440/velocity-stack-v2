'use client'

import { useMemo } from 'react'
import { buildPreview, formatElapsed, intensityColor, previewSummaryText, scalePower, timeTicks, valueTicks } from '../lib/workoutPreview'

const W = 640
const H = 190
const PAD = { l: 40, r: 10, t: 10, b: 22 }

/**
 * Read-only workout preview (elapsed time x power) from a parsed DSL manifest. Blocks are coloured by intensity,
 * the lighter part is the band's upper range, warm-up / cool-down are ramps, the dashed line is FTP.
 * `ftp` null -> the axis is %FTP. `compact` renders a small axis-less thumbnail.
 */
export default function WorkoutPreviewChart({ manifest, ftp = null, compact = false, className = '' }) {
  const preview = useMemo(() => buildPreview(manifest, { ftp }), [manifest, ftp])
  if (!preview) return null

  const unitLabel = preview.unit === 'w' ? 'W' : '%'
  const maxVal = scalePower(Math.max(preview.maxFraction, 1.05), preview)
  const { ticks, top } = valueTicks(maxVal)
  const l = compact ? 2 : PAD.l
  const r = compact ? 2 : PAD.r
  const t = compact ? 2 : PAD.t
  const b = compact ? 2 : PAD.b
  const h = compact ? 40 : H
  const x = (s) => l + (s / preview.durationS) * (W - l - r)
  const y = (v) => h - b - (v / top) * (h - t - b)
  const yf = (fraction) => y(scalePower(fraction, preview))
  const base = y(0)

  return (
    <figure className={className} data-testid={compact ? 'workout-preview-thumb' : 'workout-preview'}>
      <svg viewBox={`0 0 ${W} ${h}`} className="w-full h-auto" role="img" aria-label={previewSummaryText(preview)} preserveAspectRatio="xMidYMid meet">
        {!compact && ticks.map((v) => (
          <g key={`y${v}`}>
            <line x1={l} x2={W - r} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth="0.5" />
            <text x={l - 4} y={y(v) + 3} textAnchor="end" fontSize="9" fontWeight="600" fill="currentColor" className="text-slate-400">{v}{v === top ? unitLabel : ''}</text>
          </g>
        ))}
        {preview.segments.map((s, i) => {
          const x1 = x(s.startS)
          const x2 = x(s.endS)
          if (s.ramp) {
            const [a, z] = s.ramp
            const color = intensityColor(Math.max(a, z))
            return <polygon key={i} points={`${x1},${base} ${x1},${yf(a)} ${x2},${yf(z)} ${x2},${base}`} fill={color} fillOpacity="0.8" />
          }
          const color = intensityColor(s.hi)
          const wd = Math.max(1, x2 - x1 - (x2 - x1 > 3 ? 0.5 : 0))
          return (
            <g key={i}>
              <rect x={x1} y={yf(s.hi)} width={wd} height={Math.max(0, base - yf(s.hi))} fill={color} fillOpacity={s.lo < s.hi ? 0.4 : 0.85} />
              {s.lo < s.hi && s.lo > 0 && <rect x={x1} y={yf(s.lo)} width={wd} height={Math.max(0, base - yf(s.lo))} fill={color} fillOpacity="0.85" />}
            </g>
          )
        })}
        {!compact && (
          <>
            <line x1={l} x2={W - r} y1={yf(1)} y2={yf(1)} stroke="#0ea5e9" strokeWidth="1" strokeDasharray="4 3" />
            <text x={W - r - 2} y={yf(1) - 3} textAnchor="end" fontSize="9" fontWeight="700" fill="#0ea5e9">FTP{preview.unit === 'w' ? ` ${preview.ftp}W` : ''}</text>
            {timeTicks(preview.durationS).map((s) => (
              <text key={`x${s}`} x={x(s)} y={h - 6} textAnchor={s === 0 ? 'start' : s / preview.durationS > 0.95 ? 'end' : 'middle'} fontSize="9" fontWeight="600" fill="currentColor" className="text-slate-400">{formatElapsed(s)}</text>
            ))}
          </>
        )}
      </svg>
      {!compact && (
        <figcaption className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
          {preview.unit === 'pct' && <div>Set an FTP in physiology to see absolute watts (axis shows % of FTP).</div>}
          {preview.partial && <div>Partial preview: {preview.untimed} distance-based step{preview.untimed === 1 ? '' : 's'} cannot be placed on the time axis.</div>}
          {preview.segments.some((s) => s.approx) && <div>Warm-up / cool-down ramps and steps without a power target are drawn at default levels.</div>}
        </figcaption>
      )}
    </figure>
  )
}
