// "What's new" entries: markdown files in content/news with a small frontmatter block (issue #244).
// Pure helpers only (parsing, validation, ordering, unseen logic); reading the files is in server/newsContent.js.
// How to write an entry: docs/news.md.

export const NEWS_ID_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Splits `---` frontmatter from the body. Only flat `key: value` lines are supported. */
export function parseFrontmatter(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(text)
  if (!m) throw new Error('missing frontmatter (--- block at the top)')
  const data = {}
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!kv) throw new Error(`invalid frontmatter line: "${line}"`)
    let value = kv[2].trim()
    if (/^(".*"|'.*')$/.test(value) && value.length >= 2) value = value.slice(1, -1)
    data[kv[1]] = value
  }
  return { data, body: m[2].trim() }
}

const safeTarget = (v) => /^\/(?!\/)[\w\-./?#=&%]*$/.test(v) || /^https:\/\/[^\s<>"']+$/.test(v)

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * Parses and validates one file. `fileName` (without .md) must equal the id so ids stay unique and sortable.
 * @returns {{ id, date, title, body, image?, imageAlt?, link?, linkLabel? }}
 */
export function parseNewsEntry(raw, fileName) {
  const { data, body } = parseFrontmatter(raw)
  const where = fileName ? `${fileName}: ` : ''
  const fail = (msg) => {
    throw new Error(`${where}${msg}`)
  }
  if (!NEWS_ID_RE.test(data.id || '')) fail('id must look like YYYY-MM-DD-short-slug (lowercase letters, digits, hyphens)')
  if (fileName && data.id !== fileName) fail(`id "${data.id}" must match the file name`)
  if (!isRealDate(data.date || '')) fail('date must be a real YYYY-MM-DD date')
  if (!data.id.startsWith(data.date)) fail('id must start with the date')
  if (!data.title || data.title.length > 100) fail('title is required (max 100 characters)')
  if (!body) fail('body is empty')
  if (body.length > 4000) fail('body is too long (max 4000 characters)')
  const entry = { id: data.id, date: data.date, title: data.title, body }
  if (data.image) {
    if (!safeTarget(data.image)) fail('image must be a /public path or an https URL')
    entry.image = data.image
    entry.imageAlt = data.imageAlt || ''
  }
  if (data.link) {
    if (!safeTarget(data.link)) fail('link must be an in-app path or an https URL')
    entry.link = data.link
    entry.linkLabel = data.linkLabel || 'Learn more'
  }
  return entry
}

/** Newest first (ids start with their date, so the id decides ties). */
export function sortNewestFirst(entries) {
  return [...entries].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

/** Entries the user has not seen yet, newest first. `seenThrough` is the stored marker ('' = nothing seen). */
export function unseenEntries(entries, seenThrough) {
  const seen = typeof seenThrough === 'string' ? seenThrough : ''
  return sortNewestFirst(entries).filter((e) => e.id > seen)
}

/** The marker to store after the user has seen `entries` (never lower than what is already stored). */
export function newestSeenMarker(entries, seenThrough = '') {
  const newest = sortNewestFirst(entries)[0]?.id || ''
  return newest > seenThrough ? newest : seenThrough
}
