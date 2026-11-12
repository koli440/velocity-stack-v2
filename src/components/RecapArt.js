import { artScene, artBackground, ART_VIEWBOX, CURVE_COLORS } from '../lib/recapArt'

// SVG backdrop for a recap card (see lib/recapArt.js). Plain SVG and inline styles only, so it also renders in next/og (satori).
export default function RecapArt({ id, style = {} }) {
  const scene = artScene(id)
  const gid = `ra-${id}`
  const { width, height } = ART_VIEWBOX
  return (
    <div aria-hidden="true" data-testid="recap-art" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', background: artBackground(id), ...style }}>
      <svg width={style.width || '100%'} height={style.height || '100%'} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', top: 0, left: 0, width: style.width || '100%', height: style.height || '100%' }}>
        <defs>
          <linearGradient id={`${gid}-curve`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={CURVE_COLORS[0]} />
            <stop offset="1" stopColor={CURVE_COLORS[1]} />
          </linearGradient>
          <radialGradient id={`${gid}-glow`} cx={scene.glow.x} cy={scene.glow.y} r="0.6">
            <stop offset="0" stopColor={scene.glow.color} stopOpacity={scene.glow.opacity} />
            <stop offset="1" stopColor={scene.glow.color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={width} height={height} fill={`url(#${gid}-glow)`} />
        <g fill="none" strokeLinecap="round">
          {scene.paths.map((p, i) => (
            <path
              key={i}
              d={p.d}
              fill={p.fill || 'none'}
              fillOpacity={p.fillOpacity}
              stroke={p.stroke === 'curve' ? `url(#${gid}-curve)` : p.stroke}
              strokeOpacity={p.stroke === 'curve' ? undefined : p.opacity}
              strokeWidth={p.stroke ? p.width : undefined}
              strokeDasharray={p.dash}
            />
          ))}
        </g>
        {(scene.dots || []).map((d, i) => <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill={d.fill} fillOpacity={d.opacity} />)}
      </svg>
    </div>
  )
}
