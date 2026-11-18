import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NAV_ITEMS, buildNavTree, recentThreads, isNavItemLocked, MESSAGES_PREVIEW_LIMIT } from '../navigation.js'
import { ADMIN_LINKS } from '../adminLinks.js'
import {
  isLeafActive, isNodeActive, activeGroupKey, groupContains, parseOpenGroup, serializeOpenGroup,
  withActiveGroupOpen, toggleGroup, badgeLabel, breadcrumbTrail,
} from '../navState.js'

const keys = (tree) => tree.map((n) => n.key)
const find = (tree, key) => tree.find((n) => n.key === key)
const th = (id, minutes, extra = {}) => ({ id, other_name: `Rider ${id}`, unread: 0, last_message_at: minutes == null ? null : new Date(Date.UTC(2026, 10, 18, 9, minutes)).toISOString(), ...extra })

test('menu tree: top level, groups and their order', () => {
  const tree = buildNavTree({ signedIn: true })
  assert.deepEqual(keys(tree), ['home', 'training', 'pb-vault', 'tools', 'community', 'lab', 'settings', 'about', 'feedback'])
  assert.deepEqual(find(tree, 'training').children.map((c) => c.label), ['Calendar', 'Fitness', 'Templates'])
  assert.deepEqual(find(tree, 'tools').children.map((c) => c.label), ['Gear Architect', 'Pursuit Strategist', 'Velodromes'])
  assert.deepEqual(find(tree, 'home').children.map((c) => c.href), ['/', '/?scope=following'])
  assert.deepEqual(find(tree, 'community').children[0].children.map((c) => c.href), ['/riders?tab=find', '/riders?tab=following'])
})

test('top-level order with every conditional item present', () => {
  const tree = buildNavTree({ signedIn: true, isAdmin: true, moduleEnabled: true, threads: [th('a', 1)] })
  assert.deepEqual(keys(tree), ['home', 'training', 'messages', 'pb-vault', 'tools', 'community', 'coaching', 'lab', 'admin', 'settings', 'about', 'feedback'])
})

test('lab group links the lab pages', () => {
  const lab = find(buildNavTree(), 'lab')
  assert.deepEqual(lab.children.map((c) => c.href), ['/lab/protocols', '/lab/lactate', '/lab/schedule', '/lab/profile', '/lab/durability', '/lab/decoupling', '/lab/forms', '/lab/reports'])
})

test('coaching, admin and messages are conditional', () => {
  assert.ok(!keys(buildNavTree({ signedIn: true })).includes('coaching'))
  assert.deepEqual(find(buildNavTree({ signedIn: true, moduleEnabled: true }), 'coaching').children.map((c) => c.href), ['/coach'])
  assert.ok(!keys(buildNavTree({ signedIn: true, isAdmin: false })).includes('admin'))
  assert.ok(!keys(buildNavTree({ signedIn: false, isAdmin: true })).includes('admin'))
  assert.equal(find(buildNavTree({ signedIn: true, isAdmin: true }), 'admin').children.length, ADMIN_LINKS.length)
  assert.ok(!keys(buildNavTree({ signedIn: true, threads: [] })).includes('messages'))
  assert.ok(keys(buildNavTree({ signedIn: true, threads: [th('a', 1)] })).includes('messages'))
  assert.ok(!keys(buildNavTree({ signedIn: true, hasPayments: true })).includes('payments'), 'payments is a Settings child')
  assert.ok(find(buildNavTree({ signedIn: true, hasPayments: true }), 'settings').children.some((c) => c.href === '/payments'))
  assert.ok(!find(buildNavTree({ signedIn: true }), 'settings').children.some((c) => c.href === '/payments'))
  assert.equal(activeGroupKey(buildNavTree({ signedIn: true, hasPayments: true }), '/payments'), 'settings')
})

test('logged-out visitors keep locked items and the public coach directory', () => {
  const tree = buildNavTree({ signedIn: false })
  assert.ok(find(tree, 'community').children.some((c) => c.key === 'coach-directory'))
  assert.equal(isNavItemLocked(find(tree, 'pb-vault'), false), true)
  assert.equal(isNavItemLocked(find(tree, 'home'), false), false)
  assert.equal(isNavItemLocked(find(tree, 'tools').children[0], false), false)
})

test('messages lists the 5 most recent conversations plus View all', () => {
  const threads = [th('a', 1), th('b', 50, { unread: 3 }), th('c', 20), th('d', null), th('e', 40), th('f', 30), th('g', 10)]
  const recent = recentThreads(threads)
  assert.deepEqual(recent.map((t) => t.id), ['b', 'e', 'f', 'c', 'g'])
  assert.equal(recent.length, MESSAGES_PREVIEW_LIMIT)
  const messages = find(buildNavTree({ threads }), 'messages')
  assert.deepEqual(messages.children.map((c) => c.href), ['/chat/b', '/chat/e', '/chat/f', '/chat/c', '/chat/g', '/chat'])
  assert.equal(messages.children[0].unread, 3)
  assert.equal(messages.children.at(-1).label, 'View all')
})

test('flat top-level tool list is unchanged', () => {
  assert.equal(NAV_ITEMS.length, 12)
})

test('leaf active state follows path and query', () => {
  const home = find(buildNavTree(), 'home')
  const [mine, following] = home.children
  assert.equal(isLeafActive(mine, '/', ''), true)
  assert.equal(isLeafActive(following, '/', ''), false)
  assert.equal(isLeafActive(mine, '/', 'scope=following'), false)
  assert.equal(isLeafActive(following, '/', 'scope=following'), true)
  assert.equal(isLeafActive(mine, '/gears', ''), false)
  const riders = find(buildNavTree(), 'community').children[0]
  assert.equal(isLeafActive(riders.children[0], '/riders', ''), true)
  assert.equal(isLeafActive(riders.children[1], '/riders', 'tab=following'), true)
  assert.equal(isLeafActive(riders.children[0], '/riders', 'tab=following'), false)
  assert.equal(isLeafActive({ href: '/calendar' }, '/calendar/', ''), true)
  assert.equal(isLeafActive({ href: '/fit' }, '/fitness', ''), false)
})

test('the group of the current page is found for auto-open', () => {
  const tree = buildNavTree({ signedIn: true, isAdmin: true, moduleEnabled: true })
  assert.equal(activeGroupKey(tree, '/calendar'), 'training')
  assert.equal(activeGroupKey(tree, '/lab/durability'), 'lab')
  assert.equal(activeGroupKey(tree, '/lab'), 'lab')
  assert.equal(activeGroupKey(tree, '/riders', 'tab=following'), 'community')
  assert.equal(activeGroupKey(tree, '/admin/coach-plans'), 'admin')
  assert.equal(activeGroupKey(tree, '/coach'), 'coaching')
  assert.equal(activeGroupKey(tree, '/settings/coach-card'), 'settings')
  assert.equal(activeGroupKey(tree, '/connections'), 'settings')
  assert.equal(activeGroupKey(tree, '/'), 'home')
  assert.equal(activeGroupKey(buildNavTree({ signedIn: true, threads: [{ id: 't1', other_name: 'A', unread: 1, last_message_at: '2026-01-01' }] }), '/chat/t1'), 'messages')
  assert.equal(activeGroupKey(tree, '/pb-vault'), null)
  assert.equal(groupContains(find(tree, 'tools'), '/gears/x'), true)
  assert.equal(isNodeActive(find(tree, 'home'), '/', ''), true)
})

test('open groups are remembered safely', () => {
  assert.equal(parseOpenGroup(null), null)
  assert.equal(parseOpenGroup('not json'), 'not json')
  assert.equal(parseOpenGroup('{"a":1}'), null)
  assert.equal(parseOpenGroup('"lab"'), 'lab')
  assert.equal(parseOpenGroup('["lab","tools"]'), 'lab')
  assert.equal(serializeOpenGroup('lab'), '"lab"')
  assert.equal(serializeOpenGroup(null), 'null')
  assert.equal(parseOpenGroup('null'), null)
  assert.equal(withActiveGroupOpen('tools', 'lab'), 'lab')
  assert.equal(withActiveGroupOpen('lab', null), 'lab')
  assert.equal(withActiveGroupOpen(null, null), null)
  assert.equal(toggleGroup('lab', 'lab'), null)
  assert.equal(toggleGroup('lab', 'tools'), 'tools')
  assert.equal(toggleGroup(null, 'tools'), 'tools')
})

test('unread badge label is capped', () => {
  assert.equal(badgeLabel(0), '')
  assert.equal(badgeLabel(7), '7')
  assert.equal(badgeLabel(120), '99+')
})

test('drawer and bottom bar wiring', () => {
  const read = (p) => readFileSync(new URL(`../../components/${p}`, import.meta.url), 'utf8')
  assert.match(read('Sidebar.js'), /<NavTree/)
  assert.match(read('AppShell.js'), /<BottomNav/)
  const bar = read('BottomNav.js')
  assert.match(bar, /lg:hidden/)
  assert.match(bar, /safe-area-inset-bottom/)
  assert.match(bar, /'Overview'/)
  assert.match(read('Sidebar.js'), /buildAthleteTree/)
  assert.match(read('SegmentedTabs.js'), /min-h-\[44px\] sm:min-h-0/)
  assert.match(read('NavTree.js'), /min-h-\[44px\]/)
})

test('templates sub-items follow ?tab= and open the Training group', () => {
  const tree = buildNavTree({ signedIn: true })
  const tpl = find(tree, 'training').children.find((c) => c.key === 'templates')
  assert.deepEqual(tpl.children.map((c) => c.query.tab), ['public', 'mine', 'favorites', 'system'])
  assert.equal(isLeafActive(tpl.children[1], '/templates', 'tab=mine'), true)
  assert.equal(isLeafActive(tpl.children[1], '/templates', 'tab=public'), false)
  assert.equal(activeGroupKey(tree, '/templates', 'tab=favorites'), 'training')
})

test('breadcrumb trail from the menu tree', () => {
  const tree = buildNavTree({ signedIn: true, isAdmin: true, moduleEnabled: true })
  const labels = (p, s) => breadcrumbTrail(tree, p, s).map((c) => c.label)
  assert.deepEqual(labels('/lab/durability'), ['Lab', 'Durability'])
  assert.deepEqual(labels('/admin/chat-reports'), ['Admin', 'Chat reports'])
  assert.deepEqual(labels('/admin'), ['Admin', 'Dashboard'])
  assert.deepEqual(labels('/riders', 'tab=following'), ['Riders', 'Following'])
  assert.deepEqual(labels('/riders'), ['Riders', 'Find'])
  assert.deepEqual(labels('/templates', 'tab=mine'), ['Templates', 'Mine'])
  assert.deepEqual(labels('/nowhere'), [])
  assert.equal(breadcrumbTrail(tree, '/lab/durability')[0].href, '/lab')
  assert.equal(breadcrumbTrail(tree, '/lab/durability')[1].href, undefined)
})

test('in-page tab strips are gone; pages use the breadcrumb', () => {
  const r = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  assert.doesNotMatch(r('../../app/riders/page.js'), /SegmentedTabs/)
  assert.doesNotMatch(r('../../app/admin/layout.js'), /AdminNav/)
  assert.doesNotMatch(r('../../components/LabShell.js'), /aria-label="Lab tools"|All lab tools/)
  assert.match(r('../../components/LabShell.js'), /crumbs=\{/)
  assert.doesNotMatch(r('../../components/admin/AdminUi.js'), /Admin dashboard/)
  assert.doesNotMatch(r('../../app/admin/suggestions/[id]/page.js'), /All suggestions/)
  assert.doesNotMatch(r('../../app/coach/[riderId]/layout.js'), /Athlete sections/)
  assert.match(r('../../app/templates/page.js'), /<PageBreadcrumb/)
})
