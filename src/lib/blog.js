// Blog posts: markdown files in content/blog with a small frontmatter block.
// Pure helpers only (parsing, validation, scheduling, ordering, SEO data); reading the files is in server/blogContent.js.
// How to write and schedule a post: docs/blog.md.
import { parseFrontmatter } from './news.js'
import { parseMarkdown } from './markdownLite.js'
import { slugifyHeading } from './legal.js'
import { SITE_URL, SITE_NAME, truncateWords, MAX_DESCRIPTION } from './seo.js'

export const BLOG_PATH = '/blog'
export const isBlogPath = (pathname) => pathname === BLOG_PATH || String(pathname || '').startsWith(`${BLOG_PATH}/`)

export const BLOG_TITLE = 'The VelocityStack blog'
export const BLOG_DESCRIPTION = 'A plain journal from the person who builds VelocityStack: track cycling, gearing, training analysis and what I learn along the way.'

export const BLOG_AUTHOR = Object.freeze({
  name: 'koli440',
  bio: 'builds Velocity Stack',
  // Optional bundled image (served from public/); the byline falls back to initials without it.
  avatarFile: 'avatars/koli440.webp',
})

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const WORDS_PER_MINUTE = 220
// Posts at least this long (and with enough headings) get a table of contents.
export const TOC_MIN_MINUTES = 3
export const TOC_MIN_HEADINGS = 3

const safeUrl = (v) => /^https:\/\/[^\s<>"']+$/.test(v)
const safePublicPath = (v) => /^\/(?!\/)[\w\-./]+\.(?:png|jpe?g|webp|avif|gif)$/i.test(v)

export function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export const todayUtc = (now = new Date()) => new Date(now).toISOString().slice(0, 10)

/** A post is public from 00:00 UTC on its date. Future-dated posts are hidden everywhere until then. */
export const isPublished = (post, now = new Date()) => !!post && post.date <= todayUtc(now)

export const publishedPosts = (posts, now = new Date()) => posts.filter((p) => isPublished(p, now))

/** Newest first; the slug breaks ties so the order is stable. */
export function sortPostsNewestFirst(posts) {
  return [...posts].sort((a, b) => (a.date === b.date ? (a.slug < b.slug ? 1 : -1) : a.date < b.date ? 1 : -1))
}

export function wordCount(text) {
  const t = String(text ?? '').trim()
  return t ? t.split(/\s+/).length : 0
}

export const readingMinutes = (body) => Math.max(1, Math.round(wordCount(body) / WORDS_PER_MINUTE))

/**
 * Parses and validates one file. `slug` is the file name without .md and becomes the permanent URL.
 * @returns {{ slug, title, date, updated, summary, tags, cover?, coverAlt?, coverWidth?, coverHeight?, canonicalUrl?, body, minutes }}
 */
export function parseBlogPost(raw, slug) {
  const { data, body } = parseFrontmatter(raw)
  const fail = (msg) => {
    throw new Error(`${slug ? `${slug}: ` : ''}${msg}`)
  }
  if (!SLUG_RE.test(slug || '')) fail('file name must be a lowercase slug (letters, digits, hyphens)')
  if (!data.title || data.title.length > 110) fail('title is required (max 110 characters)')
  if (!isRealDate(data.date || '')) fail('date must be a real YYYY-MM-DD date')
  if (data.updated && (!isRealDate(data.updated) || data.updated < data.date)) fail('updated must be a real YYYY-MM-DD date on or after date')
  if (!data.summary || data.summary.length > 200) fail('summary is required (max 200 characters)')
  if (!body) fail('body is empty')
  if (/<[a-z/][^>]*>/i.test(body)) fail('HTML is not supported in the body')
  const tags = (data.tags || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  if (new Set(tags).size !== tags.length) fail('tags must be unique')
  if (tags.length > 6 || tags.some((t) => !SLUG_RE.test(t))) fail('tags: up to 6 comma-separated lowercase words (letters, digits, hyphens)')
  const post = { slug, title: data.title, date: data.date, updated: data.updated || data.date, summary: data.summary, tags, body, minutes: readingMinutes(body) }
  if (data.cover) {
    if (!safePublicPath(data.cover)) fail('cover must be an image path inside public/, e.g. /blog/cover.webp')
    if (!data.coverAlt) fail('coverAlt is required when there is a cover')
    const w = Number(data.coverWidth)
    const h = Number(data.coverHeight)
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 200 || h < 100) fail('coverWidth and coverHeight (pixels) are required with a cover')
    Object.assign(post, { cover: data.cover, coverAlt: data.coverAlt, coverWidth: w, coverHeight: h })
  }
  if (data.canonicalUrl) {
    if (!safeUrl(data.canonicalUrl)) fail('canonicalUrl must be an https URL')
    post.canonicalUrl = data.canonicalUrl
  }
  return post
}

export const postPath = (post) => `${BLOG_PATH}/${post.slug}`
export const postUrl = (post) => `${SITE_URL}${postPath(post)}`
export const postCanonical = (post) => post.canonicalUrl || postUrl(post)
export const ogImagePath = (post) => `${postPath(post)}/og-image`
export const postImage = (post) => (post.cover ? { url: post.cover, width: post.coverWidth, height: post.coverHeight, alt: post.coverAlt } : { url: ogImagePath(post), width: 1200, height: 630, alt: post.title })

/** Page <title>: the post title as is when it fits (the site suffix would push it over 60 characters). */
export const postTitleTag = (post) => truncateWords(post.title, 60)

export function formatPostDate(date) {
  if (!isRealDate(date)) return ''
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** h2/h3 headings with stable, unique anchor ids (the same text always gives the same id). */
export function headingsWithIds(blocks) {
  const seen = new Map()
  return blocks.map((b) => {
    if (b.type !== 'h') return b
    const text = b.inline.map((n) => n.text).join('')
    const base = slugifyHeading(text) || 'section'
    const n = seen.get(base) || 0
    seen.set(base, n + 1)
    return { ...b, text, id: n ? `${base}-${n + 1}` : base }
  })
}

export function renderBlocks(body) {
  return headingsWithIds(parseMarkdown(body))
}

export function tocFor(post) {
  const heads = renderBlocks(post.body).filter((b) => b.type === 'h')
  if (post.minutes < TOC_MIN_MINUTES || heads.length < TOC_MIN_HEADINGS) return []
  return heads.map((h) => ({ id: h.id, text: h.text, level: h.level }))
}

/** Neighbours in the (already published-only, newest first) list. `newer`/`older` are null at the ends. */
export function prevNext(posts, slug) {
  const i = posts.findIndex((p) => p.slug === slug)
  if (i < 0) return { newer: null, older: null }
  return { newer: posts[i - 1] || null, older: posts[i + 1] || null }
}

/** Posts sharing the most tags (at least one), newest first among equals. */
export function relatedPosts(posts, post, limit = 3) {
  return sortPostsNewestFirst(posts)
    .filter((p) => p.slug !== post.slug)
    .map((p) => ({ p, shared: p.tags.filter((t) => post.tags.includes(t)).length }))
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, limit)
    .map((x) => x.p)
}

/** Only the app's own storage bucket (or a bundled /avatars path) is accepted as an avatar source. */
export function safeAvatarUrl(v, supabaseUrl = '') {
  if (typeof v !== 'string' || v.length > 500) return null
  if (/^\/avatars\/[\w\-./]+\.(?:png|jpe?g|webp)$/i.test(v)) return v
  const prefix = `${String(supabaseUrl).replace(/\/+$/, '')}/storage/v1/object/public/avatars/`
  return supabaseUrl && v.startsWith(prefix) && /^https:\/\/[^\s<>"']+$/.test(v) ? v : null
}

export function shareLinks(post) {
  const url = encodeURIComponent(postUrl(post))
  const title = encodeURIComponent(post.title)
  return [
    ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${url}`],
    ['X', `https://twitter.com/intent/tweet?url=${url}&text=${title}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${url}`],
    ['WhatsApp', `https://wa.me/?text=${encodeURIComponent(`${post.title} ${postUrl(post)}`)}`],
    ['Reddit', `https://www.reddit.com/submit?url=${url}&title=${title}`],
    ['Email', `mailto:?subject=${title}&body=${url}`],
  ]
}

export function postDescription(post) {
  return truncateWords(post.summary, MAX_DESCRIPTION)
}

export function blogPostingJsonLd(post, avatarUrl = null) {
  const image = postImage(post)
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.summary,
    datePublished: post.date,
    dateModified: post.updated,
    mainEntityOfPage: postCanonical(post),
    url: postUrl(post),
    image: image.url.startsWith('http') ? image.url : `${SITE_URL}${image.url}`,
    keywords: post.tags.join(', '),
    inLanguage: 'en',
    wordCount: wordCount(post.body),
    author: { '@type': 'Person', name: BLOG_AUTHOR.name, ...(avatarUrl ? { image: `${SITE_URL}${avatarUrl}` } : {}) },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  }
}

export function breadcrumbJsonLd(post) {
  const items = [
    ['Home', SITE_URL],
    ['Blog', `${SITE_URL}${BLOG_PATH}`],
    ...(post ? [[post.title, postUrl(post)]] : []),
  ]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
  }
}

const xml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** RSS 2.0 for the given (already published-only) posts. */
export function rssXml(posts) {
  const sorted = sortPostsNewestFirst(posts)
  const last = sorted[0] ? new Date(`${sorted[0].date}T00:00:00Z`).toUTCString() : new Date(0).toUTCString()
  const items = sorted.map((p) =>
    [
      '    <item>',
      `      <title>${xml(p.title)}</title>`,
      `      <link>${xml(postUrl(p))}</link>`,
      `      <guid isPermaLink="true">${xml(postUrl(p))}</guid>`,
      `      <pubDate>${new Date(`${p.date}T00:00:00Z`).toUTCString()}</pubDate>`,
      `      <description>${xml(p.summary)}</description>`,
      ...p.tags.map((t) => `      <category>${xml(t)}</category>`),
      '    </item>',
    ].join('\n'),
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${xml(BLOG_TITLE)}</title>`,
    `    <link>${SITE_URL}${BLOG_PATH}</link>`,
    `    <description>${xml(BLOG_DESCRIPTION)}</description>`,
    '    <language>en</language>',
    `    <lastBuildDate>${last}</lastBuildDate>`,
    `    <atom:link href="${SITE_URL}${BLOG_PATH}/rss.xml" rel="self" type="application/rss+xml" />`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}

/** Card data for the activity feed (published posts only). Nothing about any rider. */
export function feedCardData(post, avatarUrl = null) {
  return {
    slug: post.slug,
    title: post.title,
    summary: post.summary,
    date: post.date,
    href: postPath(post),
    cover: post.cover || null,
    coverAlt: post.coverAlt || '',
    avatarUrl,
  }
}
