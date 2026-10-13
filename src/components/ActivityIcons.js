// Inline SVG icons for the activity feed (issue #49); no icon dependency.

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

const PATHS = {
  track: <ellipse cx="12" cy="12" rx="9" ry="5.5" />,
  ride: (
    <>
      <circle cx="6" cy="16" r="3.5" />
      <circle cx="18" cy="16" r="3.5" />
      <path d="M6 16l4-8h5l3 8M10 8l3 8" />
    </>
  ),
  power: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  heart: <path d="M12 21s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  distance: <path d="M4 12h16M16 8l4 4-4 4M8 8l-4 4 4 4" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>
  ),
  pin: (
    <>
      <path d="M12 22s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v2a3 3 0 0 0 4 3M16 6h4v2a3 3 0 0 1-4 3M12 13v4M8 21h8M10 17h4" />
    </>
  ),
  trend: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  flame: <path d="M12 22a6 6 0 0 0 6-6c0-4-3-6-4-10-3 2-5 5-5 8-1-1-2-2-2-4-2 2-1 4-1 6a6 6 0 0 0 6 6z" />,
  mountain: <path d="M3 20l6-11 4 6 3-4 5 9z" />,
  speed: (
    <>
      <path d="M12 14l4-4" />
      <path d="M3 18a9 9 0 1 1 18 0" />
    </>
  ),
}

export default function Icon({ name, size = 16, className = '', title }) {
  const content = PATHS[name] || PATHS.ride
  return (
    <svg {...base} width={size} height={size} className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {content}
    </svg>
  )
}

export const BADGE_ICONS = {
  PB: 'trophy',
  POWER_RECORD: 'power',
  SPEED_RECORD: 'speed',
  IMPROVEMENT: 'trend',
  HARD_SESSION: 'flame',
  LONG_RIDE: 'distance',
  BIG_CLIMB: 'mountain',
  HIGH_POWER: 'power',
  TOP_SPEED: 'speed',
}
