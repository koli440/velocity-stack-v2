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
