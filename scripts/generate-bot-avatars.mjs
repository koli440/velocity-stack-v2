// Generates the bot persona avatars (public/avatars/bots/<persona>.png) with no dependencies.
// Run: node scripts/generate-bot-avatars.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 256
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'avatars', 'bots')

// Each persona: gradient colours and a distinctive motif drawn over it.
const PERSONAS = {
  sprinter: { a: [239, 68, 68], b: [249, 115, 22], motif: 'chevrons' },
  endurance: { a: [16, 185, 129], b: [6, 95, 70], motif: 'waves' },
  beginner: { a: [56, 189, 248], b: [99, 102, 241], motif: 'dots' },
  pursuiter: { a: [168, 85, 247], b: [30, 27, 75], motif: 'rings' },
  keirin: { a: [250, 204, 21], b: [194, 65, 12], motif: 'stripes' },
  masters: { a: [148, 163, 184], b: [30, 41, 59], motif: 'diamonds' },
}

function motifAlpha(motif, x, y) {
  const u = x / SIZE
  const v = y / SIZE
  const cx = u - 0.5
  const cy = v - 0.5
  switch (motif) {
    case 'chevrons':
      return Math.floor((Math.abs(cx) * 2 + v * 5) % 1 * 2) ? 0.28 : 0
    case 'waves':
      return Math.sin(u * 14 + Math.sin(v * 6) * 2) + v * 4 > 1.5 && Math.sin(u * 14 + Math.sin(v * 6) * 2) + v * 4 < 2.2 ? 0.3 : 0
    case 'dots':
      return Math.hypot((u * 8) % 1 - 0.5, (v * 8) % 1 - 0.5) < 0.25 ? 0.3 : 0
    case 'rings':
      return Math.floor(Math.hypot(cx, cy) * 12) % 2 ? 0.28 : 0
    case 'stripes':
      return Math.floor((u + v) * 10) % 2 ? 0.28 : 0
    case 'diamonds':
      return Math.floor((Math.abs(cx) + Math.abs(cy)) * 10) % 2 ? 0.25 : 0
    default:
      return 0
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function render({ a, b, motif }) {
  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 3 + 1)] = 0
    for (let x = 0; x < SIZE; x++) {
      const t = (x + y) / (2 * SIZE)
      const m = motifAlpha(motif, x, y)
      const o = y * (SIZE * 3 + 1) + 1 + x * 3
      for (let i = 0; i < 3; i++) {
        const base = a[i] + (b[i] - a[i]) * t
        raw[o + i] = Math.round(base + (255 - base) * m)
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT, { recursive: true })
for (const [key, spec] of Object.entries(PERSONAS)) {
  writeFileSync(join(OUT, `${key}.png`), render(spec))
  console.log(`wrote ${key}.png`)
}
