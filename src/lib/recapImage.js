// Client-side PNG of a recap (1080x1350, drawn on a canvas) for download / Web Share. Works for private recaps too:
// nothing leaves the device. Browser-only.
import { headlineStats, monthlyBars } from './recap.js'
import { avatarInitials } from './avatars.js'
import { drawRecapArt } from './recapArt.js'

export const PNG_SIZE = { width: 1080, height: 1350 }

const FONT = 'system-ui, sans-serif'

function drawAvatar(ctx, { img, name, cx, cy, r }) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  if (img) {
    const side = Math.min(img.width, img.height)
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, cx - r, cy - r, r * 2, r * 2)
  } else {
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.fillStyle = '#39ff14'
    ctx.font = `800 ${Math.round(r * 0.9)}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(avatarInitials(name), cx, cy)
  }
  ctx.restore()
  ctx.beginPath()
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2)
  ctx.lineWidth = 8
  ctx.strokeStyle = '#39ff14'
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

function drawMonthBars(ctx, bars, x, baseY, w, h) {
  const gap = 12
  const bw = (w - gap * (bars.length - 1)) / bars.length
  bars.forEach((b, i) => {
    const bh = Math.max(6, b.height * h)
    ctx.fillStyle = b.peak ? '#39ff14' : 'rgba(255,255,255,0.35)'
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x + i * (bw + gap), baseY - bh, bw, bh, 8)
    else ctx.rect(x + i * (bw + gap), baseY - bh, bw, bh)
    ctx.fill()
    ctx.fillStyle = '#94a3b8'
    ctx.font = `600 26px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(b.label, x + i * (bw + gap) + bw / 2, baseY + 36)
  })
  ctx.textAlign = 'left'
}

export function drawRecap(ctx, { name, year, stats, bars = [], avatar = null }) {
  const { width, height } = PNG_SIZE
  drawRecapArt(ctx, 'intro', { width, height })
  const shade = ctx.createLinearGradient(0, 0, 0, height)
  shade.addColorStop(0, 'rgba(2,6,23,0.1)')
  shade.addColorStop(0.4, 'rgba(2,6,23,0.4)')
  shade.addColorStop(1, 'rgba(2,6,23,0.65)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#39ff14'
  ctx.font = `800 44px ${FONT}`
  ctx.fillText('Velocity Stack', 80, 130)
  drawAvatar(ctx, { img: avatar, name, cx: width - 190, cy: 190, r: 110 })
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 150px ${FONT}`
  ctx.fillText(String(year), 80, 320)
  ctx.font = `700 52px ${FONT}`
  ctx.fillStyle = '#cbd5e1'
  ctx.fillText(name ? `${name}'s season recap` : 'My season recap', 80, 400)
  let y = 560
  for (const s of stats) {
    ctx.fillStyle = '#ffffff'
    ctx.font = `800 100px ${FONT}`
    ctx.fillText(s.value, 80, y)
    ctx.fillStyle = '#94a3b8'
    ctx.font = `600 38px ${FONT}`
    ctx.fillText(s.label, 80, y + 48)
    y += 170
  }
  if (bars.length) drawMonthBars(ctx, bars, 80, height - 150, width - 160, 130)
  ctx.fillStyle = '#64748b'
  ctx.font = `600 32px ${FONT}`
  ctx.fillText('velocity-stack.app', 80, height - 50)
}

export const AVATAR_TIMEOUT_MS = 5000

// Resolves null when the image is missing, blocked or stalls, so the PNG falls back to initials.
export function loadImage(url, timeoutMs = AVATAR_TIMEOUT_MS) {
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => { img.src = ''; resolve(null) }, timeoutMs)
    const done = (v) => { clearTimeout(timer); resolve(v) }
    img.crossOrigin = 'anonymous'
    img.onload = () => done(img)
    img.onerror = () => done(null)
    img.src = url
  })
}

/** @returns {Promise<Blob|null>} */
export async function recapPngBlob(recap, name, avatarUrl = null) {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = PNG_SIZE.width
  canvas.height = PNG_SIZE.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const avatar = await loadImage(avatarUrl)
  drawRecap(ctx, { name, year: recap.year, stats: headlineStats(recap).slice(0, 3), bars: monthlyBars(recap), avatar })
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
