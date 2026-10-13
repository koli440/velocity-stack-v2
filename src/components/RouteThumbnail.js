'use client'

import { useMemo } from 'react'
import { buildRoutePreview, routePreviewToPath, ROUTE_PREVIEW_SIZE } from '../lib/routePreview'
import Icon from './ActivityIcons'

// Tile-less SVG route preview. Falls back to a track-oval glyph when there is no GPS.
export default function RouteThumbnail({ latitude, longitude, className = '' }) {
  const preview = useMemo(() => buildRoutePreview(latitude, longitude), [latitude, longitude])

  const box = `flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 ${className}`

  if (!preview) {
    return (
      <div className={`${box} text-slate-400`} aria-label="No GPS route" role="img">
        <Icon name="track" size={32} />
      </div>
    )
  }

  return (
    <div className={box}>
      <svg
        viewBox={`0 0 ${ROUTE_PREVIEW_SIZE} ${ROUTE_PREVIEW_SIZE}`}
        className="w-full h-full"
        role="img"
        aria-label="Route preview"
      >
        <polyline
          points={routePreviewToPath(preview.points)}
          fill="none"
          stroke="#f97316"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={preview.start[0]} cy={preview.start[1]} r="3.5" fill="#22c55e" />
        <circle cx={preview.end[0]} cy={preview.end[1]} r="3.5" fill="#ef4444" />
      </svg>
    </div>
  )
}
