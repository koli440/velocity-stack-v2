// Client-side PNG of a recap (1080x1350, drawn on a canvas) for download / Web Share. Works for private recaps too:
// nothing leaves the device. Browser-only.
import { headlineStats } from './recap.js'

export const PNG_SIZE = { width: 1080, height: 1350 }

export function drawRecap(ctx, { name, year, stats }) {
  const { width, height } = PNG_SIZE
  const g = ctx.createLinearGradient(0, 0, width, height)
  g.addColorStop(0, '#020617')
  g.addColorStop(1, '#0f172a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#39ff14'
  ctx.font = '800 44px system-ui, sans-serif'
  ctx.fillText('Velocity Stack', 80, 140)
  ctx.fillStyle = '#ffffff'
  ctx.font = '800 150px system-ui, sans-serif'
  ctx.fillText(String(year), 80, 330)
  ctx.font = '700 52px system-ui, sans-serif'
  ctx.fillStyle = '#cbd5e1'
  ctx.fillText(name ? `${name}'s season recap` : 'My season recap', 80, 410)
  let y = 600
  for (const s of stats) {
    ctx.fillStyle = '#ffffff'
    ctx.font = '800 110px system-ui, sans-serif'
    ctx.fillText(s.value, 80, y)
    ctx.fillStyle = '#94a3b8'
    ctx.font = '600 40px system-ui, sans-serif'
    ctx.fillText(s.label, 80, y + 52)
    y += 200
  }
  ctx.fillStyle = '#64748b'
  ctx.font = '600 36px system-ui, sans-serif'
  ctx.fillText('velocity-stack.app', 80, height - 80)
}

/** @returns {Promise<Blob|null>} */
export function recapPngBlob(recap, name) {
  if (typeof document === 'undefined') return Promise.resolve(null)
  const canvas = document.createElement('canvas')
  canvas.width = PNG_SIZE.width
  canvas.height = PNG_SIZE.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  drawRecap(ctx, { name, year: recap.year, stats: headlineStats(recap) })
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
