// Generated blog cover artwork (no external assets). Shared by the feed card and the OG image so both look the same:
// dark indigo-to-purple gradient, orange glow, a velodrome oval with speed lines and a power curve.
// Plain SVG/inline styles only, so it also renders inside next/og (satori).
export const COVER_BACKGROUND =
  'linear-gradient(135deg, #020617 0%, #1e1b4b 50%, #5b21b6 82%, #c2410c 120%)'

export default function CoverArt({ style = {} }) {
  return (
    <svg
      aria-hidden="true"
      width="100%"
      height="100%"
      viewBox="0 0 1200 630"
      preserveAspectRatio="xMidYMid slice"
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', ...style }}
    >
      <defs>
        <linearGradient id="cv-curve" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#fb923c" />
        </linearGradient>
        <radialGradient id="cv-glow" cx="0.82" cy="0.2" r="0.6">
          <stop offset="0" stopColor="#f97316" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#cv-glow)" />
      <g fill="none" strokeLinecap="round">
        <rect x="560" y="120" width="760" height="420" rx="210" stroke="#a78bfa" strokeOpacity="0.35" strokeWidth="3" />
        <rect x="610" y="170" width="660" height="320" rx="160" stroke="#fb923c" strokeOpacity="0.45" strokeWidth="3" />
        <path d="M-40 560 L360 560" stroke="#fb923c" strokeOpacity="0.7" strokeWidth="5" />
        <path d="M-40 585 L520 585" stroke="#a78bfa" strokeOpacity="0.6" strokeWidth="4" />
        <path d="M-40 535 L220 535" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="3" />
        <path
          d="M0 500 C140 500 200 330 340 330 S520 470 660 400 S860 120 1000 160 S1160 260 1240 200"
          stroke="url(#cv-curve)"
          strokeWidth="9"
        />
      </g>
    </svg>
  )
}
