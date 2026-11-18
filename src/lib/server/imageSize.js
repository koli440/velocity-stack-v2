// Pixel size of a PNG or WebP from its header (no dependencies); null for anything else or when unreadable.
import fs from 'node:fs'
import path from 'node:path'

export function readImageSize(buf) {
  if (buf.length >= 24 && buf.toString('latin1', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16)
    if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
    if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    if (kind === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
    }
  }
  return null
}

/** Size of an image under public/ (`src` is a validated /public path). */
export function publicImageSize(src, publicDir = path.join(process.cwd(), 'public')) {
  try {
    const file = path.join(publicDir, src)
    if (!file.startsWith(publicDir + path.sep)) return null
    return readImageSize(fs.readFileSync(file).subarray(0, 64))
  } catch {
    return null
  }
}
