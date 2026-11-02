import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { RIDE_SOURCES, RIDE_SOURCE_IDS, rideSourceById, rideSourceNames, CONNECTIONS_PATH } from '../rideSources.js'
import { CHECKLIST_ITEMS, WELCOME_STEPS } from '../onboarding.js'

test('ride sources are in priority order', () => {
  assert.deepEqual(RIDE_SOURCE_IDS, ['garmin', 'wahoo', 'srm', 'intervals', 'strava'])
  assert.equal(rideSourceNames(), 'Garmin, Wahoo, SRM, Intervals.icu or Strava')
})

test('garmin is a placeholder and SRM is a file import', () => {
  assert.equal(rideSourceById('garmin').status, 'coming-soon')
  const srm = rideSourceById('srm')
  assert.equal(srm.kind, 'import')
  assert.equal(srm.href, '/import-help')
  assert.match(srm.blurb, /PC8\/PC7\/PC6\/PC5/)
  assert.equal(rideSourceById('nope'), null)
})

test('intervals is the bridge and strava is secondary', () => {
  assert.match(rideSourceById('intervals').blurb, /Zwift/)
  assert.match(rideSourceById('strava').blurb, /Secondary/)
})

test('connect sources are all available cards or placeholders', () => {
  for (const s of RIDE_SOURCES) assert.ok(['available', 'coming-soon'].includes(s.status))
})

test('onboarding points at the connections page in priority order', () => {
  const item = CHECKLIST_ITEMS.find((i) => i.id === 'source')
  assert.equal(item.href, CONNECTIONS_PATH)
  assert.ok(item.hint.startsWith('Garmin'))
  const data = WELCOME_STEPS.find((s) => s.id === 'data')
  assert.ok(data.body.indexOf('Garmin') < data.body.indexOf('Intervals.icu'))
  assert.ok(data.body.indexOf('Intervals.icu') < data.body.indexOf('Strava'))
  assert.equal(data.links[0].href, CONNECTIONS_PATH)
})

test('connections page renders cards from the registry and settings links to it', () => {
  const page = fs.readFileSync(new URL('../../components/ConnectionsPage.js', import.meta.url), 'utf8')
  assert.match(page, /RIDE_SOURCES\.map/)
  const settings = fs.readFileSync(new URL('../../app/settings/page.js', import.meta.url), 'utf8')
  assert.match(settings, /href="\/connections"/)
  assert.doesNotMatch(settings, /ConnectionsPanel/)
})
