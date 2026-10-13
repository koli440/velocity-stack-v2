'use client'

import { routePreviewToPath, sparklineToPath, ROUTE_PREVIEW_SIZE } from '../lib/routePreview'
import Icon from './ActivityIcons'

// Renders the persisted `activities.route_preview`: a GPS route, a power sparkline for
// indoor sessions, or a track-oval glyph when there is nothing to draw.
export default function RouteThumbnail({ preview, className = '' }) {
  const box = `flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 ${className}`
  const viewBox = `0 0 ${ROUTE_PREVIEW_SIZE} ${ROUTE_PREVIEW_SIZE}`

  if (preview?.kind === 'route' && preview.points?.length >= 2) {
    const [sx, sy] = preview.points[0]
    const [ex, ey] = preview.points[preview.points.length - 1]
    return (
      <div className={box}>
        <svg viewBox={viewBox} className="w-full h-full" role="img" aria-label="Route preview">
          <polyline
            points={routePreviewToPath(preview.points)}
            fill="none"
            stroke="#f97316"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={sx} cy={sy} r="3.5" fill="#22c55e" />
          <circle cx={ex} cy={ey} r="3.5" fill="#ef4444" />
        </svg>
      </div>
    )
  }

  if (preview?.kind === 'sparkline' && preview.values?.length >= 2) {
    return (
      <div className={box}>
        <svg viewBox={viewBox} className="w-full h-full" role="img" aria-label="Power profile">
          <polyline
            points={sparklineToPath(preview.values)}
            fill="none"
            stroke="#a855f7"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    )
  }

  return (
    <div className={`${box} text-slate-400`} aria-label="No route data" role="img">
      <Icon name="track" size={32} />
    </div>
  )
}
