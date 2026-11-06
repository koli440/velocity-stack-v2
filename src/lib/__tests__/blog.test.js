import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseBlogPost,
  isPublished,
  publishedPosts,
  sortPostsNewestFirst,
  readingMinutes,
  renderBlocks,
  tocFor,
  prevNext,
  relatedPosts,
  rssXml,
  shareLinks,
  blogPostingJsonLd,
  breadcrumbJsonLd,
  postImage,
  feedCardData,
  isBlogPath,
} from '../blog.js'
import { loadAllPosts, loadPublishedPosts, getPublishedPost, BLOG_DIR } from '../server/blogContent.js'
import { llmsTxt, llmsFullTxt } from '../llms.js'
import { PUBLIC_PATHS } from '../seo.js'

const post = (over = '', body = 'Hello **world**.', slug = 'demo') =>
  parseBlogPost(`---\ntitle: Demo post\ndate: 2026-12-01\nsummary: A short summary.\ntags: story, track\n${over}---\n${body}\n`, slug)

test('parseBlogPost reads and validates the front matter', () => {
  const p = post('updated: 2026-12-05\ncanonicalUrl: https://example.com/x\n')
  assert.equal(p.slug, 'demo')
  assert.deepEqual(p.tags, ['story', 'track'])
  assert.equal(p.updated, '2026-12-05')
  assert.equal(p.canonicalUrl, 'https://example.com/x')
  assert.equal(post().updated, '2026-12-01')
  const c = post('cover: /landing/pb-vault.webp\ncoverAlt: A chart\ncoverWidth: 1200\ncoverHeight: 630\n')
  assert.deepEqual([c.cover, c.coverAlt, c.coverWidth, c.coverHeight], ['/landing/pb-vault.webp', 'A chart', 1200, 630])
  assert.equal(postImage(c).url, '/landing/pb-vault.webp')
  assert.equal(postImage(p).url, '/blog/demo/og-image')
})

test('parseBlogPost rejects malformed posts', () => {
  assert.throws(() => post('', 'x', 'Bad Slug'), /slug/)
  assert.throws(() => parseBlogPost('no frontmatter', 'a'), /frontmatter/)
  assert.throws(() => parseBlogPost('---\ntitle: T\ndate: 2026-13-45\nsummary: s\n---\nx', 'a'), /date/)
  assert.throws(() => parseBlogPost('---\ndate: 2026-12-01\nsummary: s\n---\nx', 'a'), /title/)
  assert.throws(() => parseBlogPost('---\ntitle: T\ndate: 2026-12-01\n---\nx', 'a'), /summary/)
  assert.throws(() => post('', ''), /body/)
  assert.throws(() => post('', 'a <script>alert(1)</script>'), /HTML/)
  assert.throws(() => post('updated: 2026-11-01\n'), /updated/)
  assert.throws(() => post('tags: Not Valid\n'), /tags/)
  assert.throws(() => post('cover: https://x.test/a.png\ncoverAlt: a\ncoverWidth: 1200\ncoverHeight: 630\n'), /cover/)
  assert.throws(() => post('cover: /a.png\n'), /coverAlt/)
  assert.throws(() => post('cover: /a.png\ncoverAlt: a\n'), /coverWidth/)
  assert.throws(() => post('canonicalUrl: http://example.com\n'), /canonicalUrl/)
})

test('scheduled posts are published from their date (UTC) and never before', () => {
  const p = post()
  assert.equal(isPublished(p, new Date('2026-11-30T23:59:59Z')), false)
  assert.equal(isPublished(p, new Date('2026-12-01T00:00:00Z')), true)
  assert.equal(isPublished(p, new Date('2027-01-01T00:00:00Z')), true)
  const past = parseBlogPost('---\ntitle: Old\ndate: 2026-01-01\nsummary: s\n---\nx', 'old')
  assert.deepEqual(publishedPosts([p, past], new Date('2026-06-01T00:00:00Z')).map((x) => x.slug), ['old'])
})

test('ordering, neighbours and related posts', () => {
  const mk = (slug, date, tags) => parseBlogPost(`---\ntitle: ${slug}\ndate: ${date}\nsummary: s\ntags: ${tags}\n---\nx`, slug)
  const a = mk('a', '2026-01-01', 'story')
  const b = mk('b', '2026-02-01', 'story, gears')
  const c = mk('c', '2026-03-01', 'gears')
  const d = mk('d', '2026-03-01', 'other')
  const sorted = sortPostsNewestFirst([a, c, b, d])
  assert.deepEqual(sorted.map((p) => p.slug), ['d', 'c', 'b', 'a'])
  assert.deepEqual([prevNext(sorted, 'b').newer.slug, prevNext(sorted, 'b').older.slug], ['c', 'a'])
  assert.equal(prevNext(sorted, 'd').newer, null)
  assert.equal(prevNext(sorted, 'a').older, null)
  assert.deepEqual(prevNext(sorted, 'zzz'), { newer: null, older: null })
  assert.deepEqual(relatedPosts(sorted, b).map((p) => p.slug), ['c', 'a'])
  assert.deepEqual(relatedPosts(sorted, d), [])
})

test('headings get stable unique anchors and long posts a table of contents', () => {
  const blocks = renderBlocks('## Version one\n\ntext\n\n## Version one\n\n### It works. Then more!')
  assert.deepEqual(blocks.filter((b) => b.type === 'h').map((b) => b.id), ['version-one', 'version-one-2', 'it-works-then-more'])
  assert.equal(readingMinutes('word '.repeat(660)), 3)
  const long = post('', `## One\n\n${'word '.repeat(700)}\n\n## Two\n\nx\n\n## Three\n\ny`)
  assert.deepEqual(tocFor(long).map((h) => h.id), ['one', 'two', 'three'])
  assert.deepEqual(tocFor(post('', '## One\n\nshort')), [])
})

test('RSS lists only the given posts, escaped, newest first', () => {
  const p = parseBlogPost('---\ntitle: A & B\ndate: 2026-01-02\nsummary: <s>\ntags: x\n---\nx', 'a-b')
  const old = parseBlogPost('---\ntitle: Old\ndate: 2025-01-02\nsummary: s\n---\nx', 'old')
  const xml = rssXml([old, p])
  assert.match(xml, /<title>A &amp; B<\/title>/)
  assert.match(xml, /<description>&lt;s&gt;<\/description>/)
  assert.ok(xml.indexOf('/blog/a-b') < xml.indexOf('/blog/old'))
  assert.match(xml, /<guid isPermaLink="true">https:\/\/velocity-stack\.app\/blog\/a-b<\/guid>/)
  assert.ok(!rssXml([]).includes('<item>'))
})

test('share links, JSON-LD and feed card data', () => {
  const p = post()
  const links = Object.fromEntries(shareLinks(p))
  assert.deepEqual(Object.keys(links), ['Reddit', 'LinkedIn', 'X', 'WhatsApp'])
  assert.ok(links.Reddit.includes(encodeURIComponent('https://velocity-stack.app/blog/demo')))
  const ld = blogPostingJsonLd(p)
  assert.equal(ld['@type'], 'BlogPosting')
  assert.equal(ld.author.name, 'koli440')
  assert.equal(ld.datePublished, '2026-12-01')
  assert.equal(ld.image, 'https://velocity-stack.app/blog/demo/og-image')
  assert.deepEqual(breadcrumbJsonLd(p).itemListElement.map((i) => i.position), [1, 2, 3])
  const card = feedCardData(p)
  assert.deepEqual(Object.keys(card).sort(), ['avatarUrl', 'cover', 'coverAlt', 'date', 'href', 'slug', 'summary', 'title'])
  assert.equal(card.href, '/blog/demo')
})

test('isBlogPath and sitemap paths', () => {
  assert.ok(isBlogPath('/blog') && isBlogPath('/blog/x') && !isBlogPath('/blogger'))
  assert.ok(PUBLIC_PATHS.includes('/blog'))
})

test('llms.txt lists published posts', () => {
  const p = post()
  assert.match(llmsTxt([], [p]), /\[Demo post\]\(https:\/\/velocity-stack\.app\/blog\/demo\): A short summary\./)
  assert.match(llmsFullTxt([], {}, [p]), /## Blog/)
  assert.ok(!llmsTxt([], []).includes('## Blog'))
})

test('the loader hides future posts and fails on malformed files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-'))
  const write = (n, date) => fs.writeFileSync(path.join(dir, `${n}.md`), `---\ntitle: ${n}\ndate: ${date}\nsummary: s\n---\nBody`)
  write('past', '2026-01-01')
  write('future', '2026-12-31')
  const now = new Date('2026-06-01T12:00:00Z')
  assert.deepEqual(loadAllPosts(dir).map((p) => p.slug), ['future', 'past'])
  assert.deepEqual(loadPublishedPosts(now, dir).map((p) => p.slug), ['past'])
  assert.equal(getPublishedPost('future', now, dir), null)
  assert.equal(getPublishedPost('past', now, dir).slug, 'past')
  assert.equal(getPublishedPost('future', new Date('2026-12-31T00:00:00Z'), dir).slug, 'future')
  fs.writeFileSync(path.join(dir, 'broken.md'), '---\ntitle: x\n---\nBody')
  assert.throws(() => loadAllPosts(dir), /broken\.md/)
})

test('every post in content/blog is valid', () => {
  const posts = loadAllPosts()
  assert.ok(posts.length >= 1)
  const slugs = new Set()
  for (const p of posts) {
    assert.ok(!slugs.has(p.slug))
    slugs.add(p.slug)
    if (p.cover) assert.ok(fs.existsSync(path.join(process.cwd(), 'public', p.cover)), `${p.slug}: cover file missing`)
    // Internal links in the body must point at real in-app paths.
    for (const m of p.body.matchAll(/\]\((\/[^)\s]*)\)/g)) assert.match(m[1], /^\/[\w\-./?#=&%]*$/)
  }
  assert.ok(fs.existsSync(BLOG_DIR))
})

test('the launch post exists, is published and never future-dated', () => {
  const p = loadAllPosts().find((x) => x.slug === 'why-i-built-velocity-stack')
  assert.ok(p)
  assert.equal(p.title, 'Why I built Velocity Stack (it started with a spreadsheet)')
  assert.equal(isPublished(p), true)
  assert.ok(p.body.includes('(/dsl-guide)') && p.body.includes('(/track)'))
})
