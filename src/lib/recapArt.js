// Background artwork for the season recap cards, in the visual language of the blog hero card (blog/CoverArt.js):
// a deep gradient, a coloured glow, velodrome ovals, speed lines and a route/power curve.
// One scene description (1200x630 viewBox) is drawn by three renderers so every surface matches:
// <RecapArt> (SVG in the browser and in next/og), and drawRecapArt (canvas, via Path2D, for the PNG).
// Pure data and string helpers only, so it also runs in node tests.

export const ART_VIEWBOX = { width: 1200, height: 630 }

const OVAL = (x, y, w, h) => {
  const r = h / 2
  return `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`
}

const speedLines = (accent) => [
  { d: 'M-40 560 L360 560', stroke: accent, opacity: 0.7, width: 5 },
  { d: 'M-40 585 L520 585', stroke: '#a78bfa', opacity: 0.6, width: 4 },
  { d: 'M-40 535 L220 535', stroke: '#ffffff', opacity: 0.35, width: 3 },
]

const ROUTE = 'M0 500 C140 500 200 330 340 330 S520 470 660 400 S860 120 1000 160 S1160 260 1240 200'
const WINDING = 'M-20 420 C100 300 180 520 300 400 S460 220 580 330 S760 520 880 380 S1060 140 1240 260'
const POWER = 'M0 520 L90 470 L150 500 L240 380 L300 430 L400 250 L470 330 L560 180 L640 300 L720 220 L800 360 L900 140 L980 260 L1080 200 L1240 300'

const dots = (cols, rows, x0, y0, dx, dy, color, opacity) => {
  const out = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push({ cx: x0 + c * dx, cy: y0 + r * dy, r: 4, fill: color, opacity: opacity * (0.4 + 0.6 * ((c + r) / (cols + rows))) })
  }
  return out
}

/** Scene per card id: background stops, glow, strokes (paths), filled dots. Colours match CARD_THEMES. */
export const ART_SCENES = {
  intro: {
    stops: ['#020617', '#064e3b', '#047857'], glow: { x: 0.82, y: 0.2, color: '#00F5A0', opacity: 0.55 }, accent: '#00F5A0',
    paths: [
      { d: OVAL(560, 120, 760, 420), stroke: '#a78bfa', opacity: 0.35, width: 3 },
      { d: OVAL(610, 170, 660, 320), stroke: '#00F5A0', opacity: 0.45, width: 3 },
      ...speedLines('#00F5A0'),
      { d: ROUTE, stroke: 'curve', width: 9 },
    ],
  },
  totals: {
    stops: ['#020617', '#0c4a6e', '#0369a1'], glow: { x: 0.2, y: 0.25, color: '#38bdf8', opacity: 0.5 }, accent: '#38bdf8',
    paths: [
      { d: 'M0 330 H1200', stroke: '#38bdf8', opacity: 0.3, width: 2 },
      { d: 'M600 330 L120 630 M600 330 L360 630 M600 330 L840 630 M600 330 L1080 630', stroke: '#7dd3fc', opacity: 0.35, width: 2 },
      { d: 'M0 420 H1200 M0 500 H1200 M0 590 H1200', stroke: '#38bdf8', opacity: 0.2, width: 2 },
      ...speedLines('#38bdf8'),
      { d: ROUTE, stroke: 'curve', width: 9 },
    ],
  },
  longest: {
    stops: ['#020617', '#1e1b4b', '#4338ca'], glow: { x: 0.85, y: 0.75, color: '#818cf8', opacity: 0.55 }, accent: '#818cf8',
    paths: [
      { d: WINDING, stroke: '#818cf8', opacity: 0.4, width: 22 },
      { d: WINDING, stroke: 'curve', width: 8 },
      { d: 'M-40 585 L520 585', stroke: '#a78bfa', opacity: 0.6, width: 4 },
      { d: 'M-40 560 L300 560', stroke: '#00F5A0', opacity: 0.7, width: 5 },
    ],
    dots: [{ cx: 1100, cy: 205, r: 14, fill: '#00F5A0', opacity: 0.9 }, { cx: 60, cy: 360, r: 10, fill: '#ffffff', opacity: 0.8 }],
  },
  power: {
    stops: ['#020617', '#7c2d12', '#d97706'], glow: { x: 0.75, y: 0.15, color: '#fbbf24', opacity: 0.55 }, accent: '#fbbf24',
    paths: [
      { d: `${POWER} L1240 630 L0 630 Z`, fill: '#fbbf24', fillOpacity: 0.12 },
      { d: POWER, stroke: '#fbbf24', width: 7 },
      { d: 'M0 200 H1200 M0 350 H1200 M0 500 H1200', stroke: '#ffffff', opacity: 0.12, width: 2 },
      ...speedLines('#fb7185').slice(0, 2),
    ],
  },
  pbs: {
    stops: ['#020617', '#78350f', '#ca8a04'], glow: { x: 0.5, y: 0.3, color: '#fde047', opacity: 0.5 }, accent: '#fde047',
    paths: [
      { d: OVAL(300, 60, 600, 600), stroke: '#fde047', opacity: 0.3, width: 3 },
      { d: OVAL(380, 140, 440, 440), stroke: '#fde047', opacity: 0.4, width: 3 },
      { d: OVAL(460, 220, 280, 280), stroke: '#ffffff', opacity: 0.35, width: 3 },
      { d: 'M600 -20 L560 630 M600 -20 L900 630 M600 -20 L300 630', stroke: '#fde047', opacity: 0.18, width: 2 },
      ...speedLines('#fde047'),
    ],
  },
  streak: {
    stops: ['#020617', '#7f1d1d', '#ea580c'], glow: { x: 0.2, y: 0.85, color: '#fb923c', opacity: 0.6 }, accent: '#fb923c',
    paths: [
      { d: 'M0 630 C200 420 260 300 420 90 M200 630 C400 440 520 320 640 120 M420 630 C640 440 760 280 900 60 M700 630 C860 470 980 340 1160 120', stroke: '#fdba74', opacity: 0.4, width: 4 },
      ...speedLines('#fb923c'),
    ],
    dots: dots(14, 4, 560, 90, 46, 44, '#fdba74', 0.7),
  },
  month: {
    stops: ['#020617', '#581c87', '#a21caf'], glow: { x: 0.8, y: 0.2, color: '#e879f9', opacity: 0.5 }, accent: '#e879f9',
    paths: [
      { d: 'M0 200 H1200 M0 330 H1200 M0 460 H1200', stroke: '#e879f9', opacity: 0.18, width: 2 },
      { d: 'M0 560 C200 520 300 600 520 540 S900 470 1200 520', stroke: '#e879f9', opacity: 0.3, width: 3 },
      ...speedLines('#e879f9').slice(0, 2),
      { d: 'M0 470 C140 470 200 330 340 330 S560 440 700 300 S980 120 1240 180', stroke: 'curve', width: 8 },
    ],
  },
  velodrome: {
    stops: ['#020617', '#134e4a', '#0f766e'], glow: { x: 0.5, y: 0.5, color: '#2dd4bf', opacity: 0.45 }, accent: '#2dd4bf',
    paths: [
      { d: OVAL(120, 110, 960, 410), stroke: '#2dd4bf', opacity: 0.4, width: 4 },
      { d: OVAL(190, 170, 820, 290), stroke: '#a78bfa', opacity: 0.4, width: 3 },
      { d: OVAL(270, 225, 660, 180), stroke: '#00F5A0', opacity: 0.5, width: 3 },
      { d: OVAL(120, 110, 960, 410), stroke: 'curve', width: 10, dash: '120 900' },
      ...speedLines('#2dd4bf'),
    ],
  },
}
ART_SCENES.empty = {
  stops: ['#020617', '#1e293b', '#334155'], glow: { x: 0.8, y: 0.2, color: '#94a3b8', opacity: 0.35 }, accent: '#94a3b8',
  paths: [{ d: OVAL(560, 120, 760, 420), stroke: '#94a3b8', opacity: 0.3, width: 3 }, ...speedLines('#94a3b8'), { d: ROUTE, stroke: 'curve', width: 8 }],
}

export const artScene = (id) => ART_SCENES[id] || ART_SCENES.empty

/** CSS linear-gradient for the base layer (also usable as the satori / DOM background). */
export const artBackground = (id) => {
  const [a, b, c] = artScene(id).stops
  return `linear-gradient(135deg, ${a} 0%, ${b} 55%, ${c} 120%)`
}

export const CURVE_COLORS = ['#a78bfa', '#00F5A0']

/** Canvas renderer: draws the scene cover-fit (like preserveAspectRatio slice) into a width x height rectangle at (x, y). */
export function drawRecapArt(ctx, id, { x = 0, y = 0, width, height }) {
  const scene = artScene(id)
  const { width: vw, height: vh } = ART_VIEWBOX
  const s = Math.max(width / vw, height / vh)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, width, height)
  ctx.clip()
  const bg = ctx.createLinearGradient(x, y, x + width, y + height)
  bg.addColorStop(0, scene.stops[0])
  bg.addColorStop(0.55, scene.stops[1])
  bg.addColorStop(1, scene.stops[2])
  ctx.fillStyle = bg
  ctx.fillRect(x, y, width, height)
  const gx = x + scene.glow.x * width
  const gy = y + scene.glow.y * height
  const gr = 0.6 * Math.max(width, height)
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr)
  glow.addColorStop(0, hexA(scene.glow.color, scene.glow.opacity))
  glow.addColorStop(1, hexA(scene.glow.color, 0))
  ctx.fillStyle = glow
  ctx.fillRect(x, y, width, height)
  ctx.translate(x + (width - vw * s) / 2, y + (height - vh * s) / 2)
  ctx.scale(s, s)
  ctx.lineCap = 'round'
  for (const p of scene.paths) {
    const path = new Path2D(p.d)
    if (p.fill) {
      ctx.globalAlpha = p.fillOpacity ?? 1
      ctx.fillStyle = p.fill
      ctx.fill(path)
    }
    if (p.stroke) {
      ctx.globalAlpha = p.stroke === 'curve' ? 1 : p.opacity ?? 1
      if (p.stroke === 'curve') {
        const g = ctx.createLinearGradient(0, 0, vw, 0)
        g.addColorStop(0, CURVE_COLORS[0])
        g.addColorStop(1, CURVE_COLORS[1])
        ctx.strokeStyle = g
      } else ctx.strokeStyle = p.stroke
      ctx.lineWidth = p.width
      ctx.setLineDash(p.dash ? p.dash.split(' ').map(Number) : [])
      ctx.stroke(path)
    }
  }
  ctx.setLineDash([])
  for (const d of scene.dots || []) {
    ctx.globalAlpha = d.opacity
    ctx.fillStyle = d.fill
    ctx.beginPath()
    ctx.arc(d.cx, d.cy, d.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
