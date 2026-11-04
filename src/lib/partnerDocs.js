import { parseMarkdown } from './markdownLite.js'

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const plain = (inline) => inline.map((n) => n.text).join('')

/** Turns docs/partner-api.md into renderable blocks (title from the first "# " line, ids on headings). */
export function parsePartnerDocs(raw) {
  let src = String(raw).replace(/\r\n?/g, '\n')
  const m = /^#\s+(.+)$/m.exec(src)
  const title = m ? m[1].trim() : 'Partner API'
  if (m) src = src.replace(m[0], '')
  src = src.replace(/\]\(\.\.\/public\/openapi\/v1\.yaml\)/g, '](/openapi/v1.yaml)')
  const seen = new Set()
  const toc = []
  const blocks = parseMarkdown(src).map((b) => {
    if (b.type !== 'h') return b
    let id = slug(plain(b.inline)) || 'section'
    while (seen.has(id)) id += '-x'
    seen.add(id)
    if (b.level === 2) toc.push({ id, text: plain(b.inline) })
    return { ...b, id }
  })
  return { title, blocks, toc }
}
