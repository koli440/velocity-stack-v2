'use client'

import { isValidRoutePoints, routePreviewToPath, sparklineToPath, ROUTE_PREVIEW_SIZE } from '../lib/routePreview'
import Icon from './ActivityIcons'

// Renders the persisted `activities.route_preview`: a GPS route, a power sparkline for
// indoor sessions, or a track-oval glyph when there is nothing to draw.
export default function RouteThumbnail({ preview, className = '', hero = false }) {
  const box = hero
    ? `flex items-center justify-center text-slate-300 ${className}`
    : `flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 ${className}`
  const viewBox = `0 0 ${ROUTE_PREVIEW_SIZE} ${ROUTE_PREVIEW_SIZE}`

  if (preview?.kind === 'route' && isValidRoutePoints(preview.points)) {
    const [sx, sy] = preview.points[0]
    const [ex, ey] = preview.points[preview.points.length - 1]
    return (
      <div className={box}>
        <svg viewBox={viewBox} className="w-full h-full" role="img" aria-label="Route preview">
          <polyline
            points={routePreviewToPath(preview.points)}
            fill="none"
            stroke={hero ? '#00F5A0' : '#f97316'}
            strokeWidth={hero ? '2.5' : '3'}
            style={hero ? { filter: 'drop-shadow(0 0 3px #00F5A0)' } : undefined}
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
            stroke={hero ? '#d8b4fe' : '#a855f7'}
            strokeWidth={hero ? '2.5' : '3'}
            style={hero ? { filter: 'drop-shadow(0 0 3px #a855f7)' } : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    )
  }

  return (
    <div className={`${box} text-slate-400`} aria-label="No route data" role="img">
      <Icon name="track" size={hero ? 48 : 32} />
    </div>
  )
}
