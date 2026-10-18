import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseFrontmatter, parseNewsEntry, sortNewestFirst, unseenEntries, newestSeenMarker } from '../news.js'
import { loadNews, NEWS_DIR } from '../server/newsContent.js'
import { parseMarkdown, parseInline } from '../markdownLite.js'

const entry = (over = '', body = 'Hello **world**.') =>
  `---\nid: 2026-12-01-demo\ndate: 2026-12-01\ntitle: Demo\n${over}---\n${body}\n`

test('parseFrontmatter reads keys, quotes and CRLF', () => {
  const { data, body } = parseFrontmatter('---\r\nid: a\r\ntitle: "Quoted: yes"\r\n---\r\nBody')
  assert.deepEqual(data, { id: 'a', title: 'Quoted: yes' })
  assert.equal(body, 'Body')
  assert.throws(() => parseFrontmatter('no frontmatter'))
  assert.throws(() => parseFrontmatter('---\nnot a pair\n---\nx'))
})

test('parseNewsEntry validates the entry', () => {
  const e = parseNewsEntry(entry('link: /calendar\nlinkLabel: Go\nimage: /news/a.png\nimageAlt: A\n'), '2026-12-01-demo')
  assert.equal(e.title, 'Demo')
  assert.equal(e.link, '/calendar')
  assert.equal(e.linkLabel, 'Go')
  assert.equal(e.image, '/news/a.png')
  assert.equal(parseNewsEntry(entry('link: https://example.com/x\n')).linkLabel, 'Learn more')
  assert.throws(() => parseNewsEntry(entry(), 'other-name'), /match the file name/)
  assert.throws(() => parseNewsEntry(entry('link: javascript:alert(1)\n')), /link/)
  assert.throws(() => parseNewsEntry(entry('link: //evil.example\n')), /link/)
  assert.throws(() => parseNewsEntry(entry('image: http://example.com/a.png\n')), /image/)
  assert.throws(() => parseNewsEntry(entry('', '')), /body/)
  assert.throws(() => parseNewsEntry('---\nid: demo\ndate: 2026-12-01\ntitle: T\n---\nx'), /id must look/)
  assert.throws(() => parseNewsEntry('---\nid: 2026-12-01-x\ndate: 2026-13-45\ntitle: T\n---\nx'), /date/)
  assert.throws(() => parseNewsEntry('---\nid: 2026-12-02-x\ndate: 2026-12-01\ntitle: T\n---\nx'), /start with the date/)
})

const E = (id) => ({ id, date: id.slice(0, 10), title: id, body: 'x' })

test('sorting and unseen logic', () => {
  const all = [E('2026-12-01-a'), E('2026-12-10-b'), E('2026-12-10-a'), E('2026-12-05-c')]
  assert.deepEqual(sortNewestFirst(all).map((e) => e.id), ['2026-12-10-b', '2026-12-10-a', '2026-12-05-c', '2026-12-01-a'])
  assert.equal(unseenEntries(all, '').length, 4)
  assert.deepEqual(unseenEntries(all, '2026-12-05-c').map((e) => e.id), ['2026-12-10-b', '2026-12-10-a'])
  assert.equal(unseenEntries(all, '2026-12-10-b').length, 0)
  assert.equal(unseenEntries(all, null).length, 4)
})

test('"seen up to now" marker used for existing users hides older entries, shows newer ones', () => {
  const marker = '2026-12-11~' // what the migration stores
  assert.equal(unseenEntries([E('2026-12-10-b'), E('2026-12-11-z')], marker).length, 0)
  assert.deepEqual(unseenEntries([E('2026-12-12-new'), E('2026-12-11-z')], marker).map((e) => e.id), ['2026-12-12-new'])
})

test('newestSeenMarker only moves forward', () => {
  const list = [E('2026-12-01-a'), E('2026-12-05-c')]
  assert.equal(newestSeenMarker(list, ''), '2026-12-05-c')
  assert.equal(newestSeenMarker(list, '2026-12-11~'), '2026-12-11~')
  assert.equal(newestSeenMarker([], 'x'), 'x')
})

test('loadNews reads a directory, ignores non-markdown, fails loudly on bad files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-'))
  fs.writeFileSync(path.join(dir, '2026-12-01-demo.md'), entry())
  fs.writeFileSync(path.join(dir, 'README.txt'), 'ignore me')
  assert.deepEqual(loadNews(dir).map((e) => e.id), ['2026-12-01-demo'])
  fs.writeFileSync(path.join(dir, '2026-12-02-bad.md'), 'broken')
  assert.throws(() => loadNews(dir), /2026-12-02-bad/)
  assert.deepEqual(loadNews(path.join(dir, 'missing')), [])
})

test('the shipped content/news entries are all valid and cover the seeded features', () => {
  const all = loadNews(NEWS_DIR)
  assert.ok(all.length >= 6)
  assert.equal(new Set(all.map((e) => e.id)).size, all.length)
  const text = all.map((e) => `${e.title} ${e.body}`).join(' ').toLowerCase()
  for (const word of ['coaching', 'calendar notes', 'planned workouts', 'races', 'intervals.icu', 'tolerance', 'nested', 'personal best']) {
    assert.ok(text.includes(word), `missing ${word}`)
  }
  for (const e of all) assert.ok(e.date <= '2026-12-11', `${e.id} must not be newer than the migration floor`)
})

test('markdownLite: paragraphs, lists, fences, inline and unsafe links', () => {
  const blocks = parseMarkdown('Intro **bold** `c`\nmore\n\n- one\n- two\n\n```\n6x\nwork 1min\n```\n\n## Head')
  assert.deepEqual(blocks.map((b) => b.type), ['p', 'ul', 'pre', 'h'])
  assert.equal(blocks[1].items.length, 2)
  assert.equal(blocks[2].text, '6x\nwork 1min')
  const inline = parseInline('[a](/x) [b](https://y.z) [c](javascript:alert(1))')
  assert.deepEqual(inline.filter((n) => n.type === 'link').map((n) => n.href), ['/x', 'https://y.z'])
  assert.ok(!inline.some((n) => n.href?.startsWith('javascript')))
  assert.equal(parseInline('<script>x</script>')[0].text, '<script>x</script>')
})
