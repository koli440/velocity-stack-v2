// Legal pages (/privacy, /terms): markdown files in content/legal with a small frontmatter block.
// Pure helpers only (parsing, validation, table of contents); reading the files is in server/legalContent.js.
import { parseFrontmatter } from './news.js'
import { parseMarkdown } from './markdownLite.js'

export const LEGAL_SLUGS = ['privacy', 'terms']
export { SITE_URL } from './seo.js'

export const isLegalPath = (pathname) => LEGAL_SLUGS.some((s) => pathname === `/${s}` || pathname === `/${s}/`)

export function slugifyHeading(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** "2027-01-10" -> "10 January 2027" (fixed English text, independent of the server locale). */
export function formatLegalDate(iso) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${months[m - 1]} ${y}`
}

const plain = (nodes) => nodes.map((n) => n.text).join('')

/**
 * Parses one legal document.
 * @returns {{ slug, title, description, updated, blocks, toc: {id, text}[] }}
 */
export function parseLegalDoc(raw, slug) {
  const { data, body } = parseFrontmatter(raw)
  const fail = (msg) => {
    throw new Error(`${slug}: ${msg}`)
  }
  if (!data.title) fail('title is required')
  if (!data.description) fail('description is required')
  if (!isRealDate(data.updated || '')) fail('updated must be a real YYYY-MM-DD date')
  if (!body) fail('body is empty')
  const blocks = parseMarkdown(body)
  const seen = new Set()
  const toc = []
  const withIds = blocks.map((b) => {
    if (b.type !== 'h') return b
    const text = plain(b.inline)
    const id = slugifyHeading(text)
    if (!id) fail(`heading "${text}" has no usable id`)
    if (seen.has(id)) fail(`duplicate heading id "${id}"`)
    seen.add(id)
    if (b.level === 2) toc.push({ id, text })
    return { ...b, id }
  })
  if (!toc.length) fail('at least one ## heading is required')
  return { slug, title: data.title, description: data.description, updated: data.updated, blocks: withIds, toc }
}
