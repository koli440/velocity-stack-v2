import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NAV_ITEMS, isNavItemActive } from '../navigation.js'

const read = (p) => readFileSync(new URL(`../../components/${p}`, import.meta.url), 'utf8')

test('menu order matches the cleaned-up design', () => {
  assert.deepEqual(
    NAV_ITEMS.map((i) => i.label),
    ['Rider Telemetry', 'Personal Best Vault', 'Gear Architect', 'Pursuit Strategist', 'Aero Lab', 'Velodromes', 'About', 'Feedback', 'Settings']
  )
  assert.equal(NAV_ITEMS[0].href, '/')
})

test('placeholder menu entries are gone', () => {
  const labels = NAV_ITEMS.map((i) => i.label).join('|')
  for (const gone of ['Rides', 'Gym', 'Analytics', 'Team']) assert.ok(!labels.includes(gone))
  assert.ok(!/Gym|Analytics|Team|Rides/.test(read('Sidebar.js')))
})

test('home is only active on exactly /', () => {
  assert.equal(isNavItemActive(NAV_ITEMS[0], '/'), true)
  assert.equal(isNavItemActive(NAV_ITEMS[0], '/gears'), false)
  assert.equal(isNavItemActive(NAV_ITEMS[2], '/gears/x'), true)
})

test('privacy zone lives in settings, not on the dashboard', () => {
  assert.match(read('ProfileSettingsModal.js'), /<PrivacyZonePanel/)
  assert.doesNotMatch(read('Dashboard.js'), /PrivacyZonePanel/)
})

test('dashboard no longer has the removed widgets', () => {
  const d = read('Dashboard.js') + read('RosterPanel.js')
  for (const gone of ['TelemetryCards', 'Quick Stats', 'Hydration', 'Gym', 'Add Workout']) assert.ok(!d.includes(gone), gone)
})

test('top banner has bell next to nickname and the add/sync chooser', () => {
  const t = read('TopNav.js')
  assert.match(t, /<NotificationBell/)
  assert.match(t, /<AddSessionModal/)
  const m = read('AddSessionModal.js')
  for (const c of ['IntervalsSyncModal', 'BulkImportModal', 'FitUploader']) assert.ok(m.includes(`<${c}`))
})
