import { isPublicContentPath, isPublicToolPath } from './publicPaths.js'
import { LAB_FEATURES } from './labFeatures.js'
import { ADMIN_LINKS } from './adminLinks.js'

// Menu definition (icon = key in lib/iconSet). NAV_ITEMS is the flat list used in athlete context
// (coachContext.sidebarItems); NAV_TREE / buildNavTree() is the grouped menu used everywhere else.
const L = {
  home: {
    key: 'home', label: 'Rider Telemetry', icon: 'home', href: '/', exact: true,
    children: [
      { key: 'home-mine', label: 'My sessions', href: '/', exact: true, query: { scope: 'mine' }, queryDefaults: { scope: 'mine' } },
      { key: 'home-following', label: 'Following', href: '/?scope=following', exact: true, query: { scope: 'following' }, queryDefaults: { scope: 'mine' } },
    ],
  },
  calendar: { key: 'calendar', label: 'Calendar', icon: 'calendar', href: '/calendar' },
  fitness: { key: 'fitness', label: 'Fitness', icon: 'chart', href: '/fitness' },
  pbVault: { key: 'pb-vault', label: 'Personal Best Vault', icon: 'trophy', href: '/pb-vault' },
  riders: {
    key: 'riders', label: 'Riders', icon: 'users', href: '/riders',
    children: [
      { key: 'riders-find', label: 'Find', href: '/riders?tab=find', query: { tab: 'find' }, queryDefaults: { tab: 'find' } },
      { key: 'riders-following', label: 'Following', href: '/riders?tab=following', query: { tab: 'following' }, queryDefaults: { tab: 'find' } },
    ],
  },
  gears: { key: 'gears', label: 'Gear Architect', icon: 'gears', href: '/gears' },
  pursuit: { key: 'pursuit', label: 'Pursuit Strategist', icon: 'stopwatch', href: '/pursuit' },
  templates: {
    key: 'templates', label: 'Templates', icon: 'clipboard', href: '/templates',
    children: [
      { key: 'templates-public', label: 'Public', href: '/templates?tab=public', query: { tab: 'public' } },
      { key: 'templates-mine', label: 'Mine', href: '/templates?tab=mine', query: { tab: 'mine' } },
      { key: 'templates-favorites', label: 'Favorites', href: '/templates?tab=favorites', query: { tab: 'favorites' } },
      { key: 'templates-system', label: 'System', href: '/templates?tab=system', query: { tab: 'system' } },
    ],
  },
  velodromes: { key: 'velodromes', label: 'Velodromes', icon: 'velodrome', href: '/velodromes' },
  about: { key: 'about', label: 'About', icon: 'book', href: '/about' },
  feedback: { key: 'feedback', label: 'Feedback', icon: 'bulb', href: '/feedback' },
  settings: { key: 'settings', label: 'Settings', icon: 'settings', href: '/settings' },
}

export const NAV_ITEMS = [
  L.home, L.calendar, L.fitness, L.pbVault, L.riders, L.gears, L.pursuit, L.templates, L.velodromes, L.about, L.feedback, L.settings,
]

// Lab pages listed in the menu (labels come from the lab feature registry).
export const LAB_MENU_KEYS = Object.freeze(['protocols', 'lactate', 'schedule', 'profile', 'durability', 'decoupling', 'forms', 'reports'])

// Flip to true once the split settings routes exist (PR 3); until then Profile and Connections are the only settings entries.
export const SETTINGS_SUBPAGES = false

export const MESSAGES_PREVIEW_LIMIT = 5

const COACH_DASHBOARD = { key: 'coach-home', label: 'Coach dashboard', href: '/coach', exact: true, leavesContext: true }
const COACH_DIRECTORY = { key: 'coach-directory', label: 'Coach directory', href: '/coaches' }

function settingsChildren() {
  if (!SETTINGS_SUBPAGES) {
    return [
      { key: 'settings-profile', label: 'Profile', href: '/settings' },
      { key: 'settings-connections', label: 'Connections', href: '/connections' },
    ]
  }
  return [
    { key: 'settings-profile', label: 'Profile', href: '/settings', exact: true },
    { key: 'settings-preferences', label: 'Preferences', href: '/settings/preferences' },
    { key: 'settings-gear', label: 'Gear and defaults', href: '/settings/gear' },
    { key: 'settings-physiology', label: 'Physiology', href: '/settings/physiology' },
    { key: 'settings-connections', label: 'Connections', href: '/connections' },
    { key: 'settings-privacy', label: 'Privacy', href: '/settings/privacy' },
    { key: 'settings-coaching', label: 'Coaching', href: '/settings/coaching' },
  ]
}

// Groups have no href: they are collapsible sections. `matches` are extra path prefixes that open the group.
const group = (key, label, icon, children, matches = []) => ({ key, label, icon, type: 'group', children, matches })

/**
 * Menu tree for the current user (own context). Entries: leaves ({ key, label, href, children? }) and
 * groups ({ type: 'group', children }). Messages carries the live conversation list as children.
 */
export function buildNavTree({ signedIn = true, isAdmin = false, moduleEnabled = false, threads = [], hasPayments = false } = {}) {
  const tree = [L.home, L.pbVault]
  const messages = messagesNode(threads)
  if (messages) tree.push(messages)
  if (signedIn && hasPayments) tree.push({ key: 'payments', label: 'Payments', icon: 'notes', href: '/payments' })

  tree.push(group('training', 'Training', 'calendar', [L.calendar, L.fitness, L.templates]))
  tree.push(group('lab', 'Lab', 'flask', LAB_MENU_KEYS.map((k) => {
    const f = LAB_FEATURES.find((x) => x.key === k)
    return { key: `lab-${k}`, label: f.label, href: `/lab/${k}` }
  }), ['/lab']))
  tree.push(group('tools', 'Tools', 'gears', [L.gears, L.pursuit, L.velodromes]))

  const community = [L.riders]
  if (!signedIn || moduleEnabled) community.push(COACH_DIRECTORY)
  tree.push(group('community', 'Community', 'users', community))

  if (signedIn && moduleEnabled) tree.push(group('coaching', 'Coaching', 'users', [COACH_DASHBOARD], ['/coach']))
  if (signedIn && isAdmin) {
    tree.push(group('admin', 'Admin', 'check', ADMIN_LINKS.map(([href, label]) => ({
      key: `admin-${href.replace(/\W+/g, '-').replace(/^-|-$/g, '')}`, label, href, exact: href === '/admin',
    })), ['/admin']))
  }

  tree.push(group('settings', 'Settings', 'settings', settingsChildren(), ['/settings']))
  tree.push(L.about, L.feedback)
  return tree
}

function messagesNode(threads) {
  const list = threads || []
  if (list.length === 0) return null
  const recent = recentThreads(list, MESSAGES_PREVIEW_LIMIT)
  return {
    key: 'messages', label: 'Messages', icon: 'chat', href: '/chat',
    children: [
      ...recent.map((t) => ({ key: `thread-${t.id}`, label: t.other_name || 'Conversation', href: `/chat/${t.id}`, unread: Number(t.unread) || 0 })),
      { key: 'messages-all', label: 'View all', href: '/chat', exact: true, viewAll: true },
    ],
  }
}

/** Most recent conversations first (by last message; threads without messages last), limited to `limit`. */
export function recentThreads(threads, limit = MESSAGES_PREVIEW_LIMIT) {
  const time = (t) => (t?.last_message_at ? new Date(t.last_message_at).getTime() || 0 : 0)
  return [...(threads || [])].sort((a, b) => time(b) - time(a)).slice(0, Math.max(0, limit))
}

// Items logged-out visitors can open (home shows the landing page). Everything else needs a free account.
export function isNavItemPublic(item) {
  if (!item?.href) return false
  return item.href === '/' || isPublicToolPath(item.href) || isPublicContentPath(item.href)
}

export const NAV_LOCKED_LABEL = 'Requires a free account'

export function isNavItemLocked(item, signedIn) {
  return !signedIn && !isNavItemPublic(item)
}

export function isNavItemActive(item, pathname) {
  if (!item.href) return false
  return item.exact ? pathname === item.href : pathname.startsWith(item.href)
}

// Window events used to let the top banner and the dashboard talk to each other.
export const OPEN_ADD_SESSION_EVENT = 'velocity:open-add-session'
export const ACTIVITIES_CHANGED_EVENT = 'velocity:activities-changed'
export const PROFILE_UPDATED_EVENT = 'velocity:profile-updated'
