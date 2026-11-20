import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../../components/${p}`, import.meta.url), 'utf8')

test('app shell and calendar switch to desktop at lg (1024px), not md', () => {
  for (const f of ['Sidebar.js', 'TopNav.js', 'AppShell.js', 'ActivityCalendar.js']) {
    assert.doesNotMatch(read(f), /\bmd:/, `${f} must not use md: (tablets use the mobile layout)`)
  }
  assert.match(read('TopNav.js'), /lg:hidden/)
  assert.match(read('ActivityCalendar.js'), /lg:grid-cols-\[repeat\(7,minmax\(0,1fr\)\)_9rem\]/)
})

test('mobile drawer is portalled above the header and backdrop', () => {
  const src = read('Sidebar.js')
  assert.match(src, /<Portal>/)
  assert.match(src, /data-testid="sidebar-drawer"/)
  const z = (re) => Number(src.match(re)[1])
  assert.ok(z(/sidebar-drawer"[\s\S]*?z-\[(\d+)\]/) > z(/sidebar-backdrop"[\s\S]*?z-\[(\d+)\]/))
  assert.match(src, /key === 'Escape'/)
})

test('calendar toolbar and weekday row stay pinned under the top bar on mobile and desktop', () => {
  const src = read('ActivityCalendar.js')
  const m = src.match(/data-testid="calendar-sticky-header" className="([^"]+)"/)
  assert.ok(m, 'sticky header wrapper exists')
  assert.match(m[1], /\bsticky\b/)
  assert.match(m[1], /\bz-20\b/)
  assert.match(m[1], /top-\[3\.75rem\]/)
  assert.match(m[1], /glass-dense/)
  assert.match(src, /lg:scroll-mt-44/)
  const header = src.slice(src.indexOf('calendar-sticky-header'), src.indexOf('aria-busy'))
  assert.match(header, /aria-label="Previous"/)
  assert.match(header, /Week total/)
})

test('root layout does not add a second mobile-web-app-capable meta (iOS viewport regression)', () => {
  const src = readFileSync(new URL('../../app/layout.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /mobile-web-app-capable/)
})
