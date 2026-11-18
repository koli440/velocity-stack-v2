import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCoachPath,
  athletePath,
  buildAthleteTree,
  COACH_MODULE_PAGES,
  bannerText,
  viewingAsOptions,
  formatLastActivity,
  formatDuration,
  formatDistanceKm,
  weeklyVolume,
} from '../coachContext.js'
import { isLeafActive, isNodeActive, activeGroupKey, flattenNav } from '../navState.js'
import { LAB_FEATURES, labSections } from '../labFeatures.js'

const RID = '11111111-2222-3333-4444-555555555555'
const ME = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

test('parseCoachPath extracts rider and subpath, rejects non-uuids', () => {
  assert.deepEqual(parseCoachPath(`/coach/${RID}`), { riderId: RID, subPath: '' })
  assert.deepEqual(parseCoachPath(`/coach/${RID}/calendar/`), { riderId: RID, subPath: '/calendar' })
  assert.deepEqual(parseCoachPath('/coach'), { riderId: null, subPath: '' })
  assert.deepEqual(parseCoachPath('/coach/not-a-uuid/calendar'), { riderId: null, subPath: '' })
  assert.deepEqual(parseCoachPath('/calendar'), { riderId: null, subPath: '' })
  assert.deepEqual(parseCoachPath(undefined), { riderId: null, subPath: '' })
})

test('athlete tree: header, grouped pages, sectioned Lab, Messages and the way back', () => {
  const tree = buildAthleteTree(RID, 'Amy')
  assert.deepEqual(tree.map((n) => n.key), ['athlete', 'overview', 'training', 'pb-vault', 'physiology', 'lab', 'messages', 'coach-home'])
  assert.equal(tree[0].type, 'header')
  assert.equal(tree[0].label, 'Viewing Amy')
  assert.equal(buildAthleteTree(RID, null)[0].label, 'Viewing athlete')
  const training = tree.find((n) => n.key === 'training')
  assert.deepEqual(training.children.map((c) => c.label), ['Activities', 'Calendar', 'Fitness', 'Templates'])
  assert.ok(training.children.every((c) => !c.icon))
  const lab = tree.find((n) => n.key === 'lab')
  assert.equal(lab.type, 'group')
  assert.deepEqual(lab.children.filter((c) => c.type === 'label').map((c) => c.label), ['Tests', 'Analysis', 'Data'])
  assert.deepEqual(lab.children.filter((c) => c.href).map((c) => c.href), [...LAB_FEATURES].sort((a, b) => ['Tests', 'Analysis', 'Data'].indexOf(a.section) - ['Tests', 'Analysis', 'Data'].indexOf(b.section)).map((f) => `/coach/${RID}/lab/${f.key}`))
  assert.deepEqual(lab.children.map((c) => c.label).slice(0, 4), ['Tests', 'Protocol runner', 'Lactate step test', 'Test scheduler'])
  assert.ok(buildAthleteTree(RID, 'Amy', true).some((c) => c.key === 'notes'))
  assert.ok(!tree.some((c) => c.key === 'notes'))
  const hrefs = flattenNav(tree).filter((n) => n.href).map((n) => n.href)
  assert.ok(hrefs.every((h) => h.startsWith('/coach')))
})

test('athlete tree active state', () => {
  const tree = buildAthleteTree(RID, 'Amy')
  const overview = tree.find((n) => n.key === 'overview')
  const activities = tree.find((n) => n.key === 'training').children[0]
  assert.equal(isLeafActive(overview, `/coach/${RID}`), true)
  assert.equal(isLeafActive(overview, `/coach/${RID}/calendar`), false)
  assert.equal(isLeafActive(activities, `/coach/${RID}/activities/abc`), true)
  assert.equal(activeGroupKey(tree, `/coach/${RID}/lab/durability`), 'lab')
  assert.equal(activeGroupKey(tree, `/coach/${RID}/activities/abc`), 'training')
  assert.equal(activeGroupKey(tree, `/coach/${RID}/physiology`), null)
  assert.equal(isNodeActive(tree.find((n) => n.key === 'lab'), `/coach/${RID}/lab/durability`), true)
  assert.equal(isLeafActive(tree.at(-1), '/coach'), true)
  assert.equal(isLeafActive(tree.find((n) => n.key === 'messages'), `/coach/${RID}/chat`), true)
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
    { sessions: 3, duration: '2h 00m', distance: '50.0 km', load: 213, gymSessions: 0 },
  )
  assert.deepEqual(weeklyVolume(null), { sessions: 0, duration: '0m', distance: '0.0 km', load: 0, gymSessions: 0 })
})

test('describeCoachEdit and coach_edited notification link', async () => {
  const { describeCoachEdit } = await import('../coachContext.js')
  const { notificationHref } = await import('../notifications.js')
  assert.equal(
    describeCoachEdit({ table_name: 'ftp_history', action: 'update', created_at: '2026-06-10T10:00:00Z' }, 'Amy'),
    'Amy updated FTP · 2026-06-10',
  )
  assert.equal(describeCoachEdit({ table_name: 'weird', action: 'x' }), 'Your coach changed settings')
  assert.equal(notificationHref({ type: 'coach_edited' }), '/settings/physiology')
  assert.equal(notificationHref({ type: 'coach_invite' }), '/settings/coaching')
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

import * as c from '../coachContext.js'

test('lab is not a flagged module page', () => {
  assert.ok(!COACH_MODULE_PAGES.some((p) => p.key === 'lab'))
})

test('athlete Messages stays in the athlete context and carries this thread\'s unread', () => {
  const messages = (threads) => buildAthleteTree(RID, 'Amy', false, threads).find((n) => n.key === 'messages')
  assert.equal(messages().href, `/coach/${RID}/chat`)
  assert.equal(messages().unread, 0)
  const threads = [
    { id: 't-old', role: 'coach', other_id: RID, status: 'ended', unread: 9 },
    { id: 't-other', role: 'coach', other_id: 'someone-else', status: 'active', unread: 4 },
    { id: 't-1', role: 'coach', other_id: RID, status: 'active', unread: 2 },
  ]
  assert.equal(messages(threads).unread, 2)
  assert.equal(c.athleteThread(threads, RID).id, 't-1')
  assert.equal(c.athleteThread([], RID), null)
  assert.equal(parseCoachPath(`/coach/${RID}/chat`).riderId, RID)
})

test('lab sections: every feature has one, unsectioned ones go under Other', () => {
  assert.ok(LAB_FEATURES.every((f) => ['Tests', 'Analysis', 'Data'].includes(f.section)))
  assert.deepEqual(labSections().map((s) => s.label), ['Tests', 'Analysis', 'Data'])
  const s = labSections([{ key: 'x', label: 'X' }, { key: 'y', label: 'Y', section: 'Data' }])
  assert.deepEqual(s.map((g) => g.label), ['Data', 'Other'])
})
