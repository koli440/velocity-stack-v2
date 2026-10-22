import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCoachPath,
  athletePath,
  navHref,
  isContextNavActive,
  bannerText,
  viewingAsOptions,
  formatLastActivity,
  formatDuration,
  formatDistanceKm,
  weeklyVolume,
} from '../coachContext.js'
import { NAV_ITEMS } from '../navigation.js'

const RID = '11111111-2222-3333-4444-555555555555'
const ME = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const item = (key) => NAV_ITEMS.find((i) => i.key === key)

test('parseCoachPath extracts rider and subpath, rejects non-uuids', () => {
  assert.deepEqual(parseCoachPath(`/coach/${RID}`), { riderId: RID, subPath: '' })
  assert.deepEqual(parseCoachPath(`/coach/${RID}/calendar/`), { riderId: RID, subPath: '/calendar' })
  assert.deepEqual(parseCoachPath('/coach'), { riderId: null, subPath: '' })
  assert.deepEqual(parseCoachPath('/coach/not-a-uuid/calendar'), { riderId: null, subPath: '' })
  assert.deepEqual(parseCoachPath('/calendar'), { riderId: null, subPath: '' })
  assert.deepEqual(parseCoachPath(undefined), { riderId: null, subPath: '' })
})

test('navHref only rewrites athlete-aware items', () => {
  assert.equal(navHref(item('calendar'), RID), `/coach/${RID}/calendar`)
  assert.equal(navHref(item('pb-vault'), RID), `/coach/${RID}/pb-vault`)
  assert.equal(navHref(item('templates'), RID), `/coach/${RID}/templates`)
  assert.equal(navHref(item('settings'), RID), `/coach/${RID}/physiology`)
  // social/account pages stay the coach's own
  assert.equal(navHref(item('home'), RID), '/')
  assert.equal(navHref(item('about'), RID), '/about')
  assert.equal(navHref(item('calendar'), null), '/calendar')
})

test('isContextNavActive highlights per context', () => {
  assert.equal(isContextNavActive(item('calendar'), `/coach/${RID}/calendar`, RID), true)
  assert.equal(isContextNavActive(item('settings'), `/coach/${RID}/physiology`, RID), true)
  assert.equal(isContextNavActive(item('home'), `/coach/${RID}`, RID), false)
  assert.equal(isContextNavActive(item('calendar'), '/calendar', null), true)
  assert.equal(isContextNavActive(item('home'), '/', null), true)
})

test('viewingAsOptions lists only my active athletes, sorted', () => {
  const rows = [
    { coach_id: ME, rider_id: 'r2', status: 'active' },
    { coach_id: ME, rider_id: 'r1', status: 'active' },
    { coach_id: ME, rider_id: 'r3', status: 'pending' },
    { coach_id: 'other', rider_id: ME, status: 'active' },
  ]
  const { athletes, hasAthletes } = viewingAsOptions(rows, ME, { r1: 'Zed', r2: 'Amy' })
  assert.deepEqual(athletes.map((a) => a.label), ['Amy', 'Zed'])
  assert.equal(athletes[0].href, '/coach/r2')
  assert.equal(hasAthletes, true)
  assert.equal(viewingAsOptions([], ME).hasAthletes, false)
  assert.equal(viewingAsOptions(null, ME).hasAthletes, false)
})

test('banner and dashboard formatting', () => {
  assert.equal(bannerText('Amy'), 'Coaching: Amy')
  assert.equal(athletePath(RID, '/x'), `/coach/${RID}/x`)
  const now = new Date('2026-06-10T12:00:00Z')
  assert.equal(formatLastActivity(null, now), 'No activity yet')
  assert.equal(formatLastActivity('2026-06-10T08:00:00Z', now), 'Today')
  assert.equal(formatLastActivity('2026-06-09T08:00:00Z', now), 'Yesterday')
  assert.equal(formatLastActivity('2026-06-05T08:00:00Z', now), '5 days ago')
  assert.equal(formatDuration(19200), '5h 20m')
  assert.equal(formatDuration(600), '10m')
  assert.equal(formatDistanceKm(123456), '123.5 km')
  assert.deepEqual(
    weeklyVolume({ week_count: 3, week_moving_time_s: 7200, week_distance_m: '50000', week_training_load: '212.6' }),
    { sessions: 3, duration: '2h 00m', distance: '50.0 km', load: 213 },
  )
  assert.deepEqual(weeklyVolume(null), { sessions: 0, duration: '0m', distance: '0.0 km', load: 0 })
})

test('describeCoachEdit and coach_edited notification link', async () => {
  const { describeCoachEdit } = await import('../coachContext.js')
  const { notificationHref } = await import('../notifications.js')
  assert.equal(
    describeCoachEdit({ table_name: 'ftp_history', action: 'update', created_at: '2026-06-10T10:00:00Z' }, 'Amy'),
    'Amy updated FTP · 2026-06-10',
  )
  assert.equal(describeCoachEdit({ table_name: 'weird', action: 'x' }), 'Your coach changed settings')
  assert.equal(notificationHref({ type: 'coach_edited' }), '/settings#physiology')
  assert.equal(notificationHref({ type: 'coach_invite' }), '/settings#coaching')
})

test('sidebarItems hides the coach\'s own pages in athlete context', async () => {
  const c = await import('../coachContext.js')
  assert.equal(c.sidebarItems(NAV_ITEMS, null), NAV_ITEMS)
  const items = c.sidebarItems(NAV_ITEMS, RID)
  const hrefs = items.map((i) => i.href)
  assert.deepEqual(hrefs, [
    `/coach/${RID}`, `/coach/${RID}/activities`, `/coach/${RID}/calendar`, `/coach/${RID}/fitness`, `/coach/${RID}/pb-vault`,
    `/coach/${RID}/templates`, `/coach/${RID}/physiology`, '/coach',
  ])
  assert.ok(hrefs.every((h) => h.startsWith('/coach')))
  assert.ok(!items.some((i) => ['home', 'gears', 'feedback', 'about', 'settings'].includes(i.key)))
  const [overview, activities] = items
  assert.equal(c.isSidebarItemActive(overview, `/coach/${RID}`), true)
  assert.equal(c.isSidebarItemActive(overview, `/coach/${RID}/calendar`), false)
  assert.equal(c.isSidebarItemActive(activities, `/coach/${RID}/activities/abc`), true)
  assert.equal(c.isSidebarItemActive(items.at(-1), '/coach'), false)
})

test('chrome visibility and context-preserving links', async () => {
  const c = await import('../coachContext.js')
  assert.ok(Object.values(c.chromeVisibility(null)).every(Boolean))
  assert.ok(Object.values(c.chromeVisibility(RID)).every((v) => v === false))
  assert.equal(c.logoHref(null), '/')
  assert.equal(c.logoHref(RID), `/coach/${RID}`)
  assert.equal(c.activityHref('a1', null), '/activities/a1')
  assert.equal(c.activityHref('a1', RID), `/coach/${RID}/activities/a1`)
  assert.equal(c.activityBackHref(null), '/')
  assert.equal(c.activityBackHref(RID), `/coach/${RID}/activities`)
  assert.equal(c.contextualHref('/activities/a1', RID), `/coach/${RID}/activities/a1`)
  assert.equal(c.contextualHref('/activities/a1', null), '/activities/a1')
  assert.equal(c.contextualHref('/templates', RID), '/templates')
})
