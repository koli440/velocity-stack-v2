// Athlete ("Viewing as") context for coaches. The context lives ONLY in the URL
// (/coach/<riderId>/...); nothing is stored. Access is enforced by the database (is_coach_of),
// this module just derives the context and builds hrefs.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const COACH_HOME_PATH = '/coach'

// Nav items that show the athlete's data when in athlete context (key -> sub path).
// Everything else (feed/home, notifications, own settings, tools, about...) stays the coach's own.
export const ATHLETE_NAV = Object.freeze({
  calendar: '/calendar',
  'pb-vault': '/pb-vault',
  templates: '/templates',
  settings: '/physiology', // the sidebar "Settings" entry becomes the athlete's physiology settings
})

// Extra athlete-only pages that have no sidebar entry of their own in the coach's context.
export const ATHLETE_PAGES = Object.freeze([
  { key: 'overview', label: 'Overview', sub: '' },
  { key: 'activities', label: 'Activities', sub: '/activities' },
  { key: 'calendar', label: 'Calendar', sub: '/calendar' },
  { key: 'pb-vault', label: 'Personal Bests', sub: '/pb-vault' },
  { key: 'templates', label: 'Templates', sub: '/templates' },
  { key: 'physiology', label: 'Physiology', sub: '/physiology' },
])

/** Parses a pathname into { riderId, subPath } (riderId null outside athlete context). */
export function parseCoachPath(pathname) {
  const m = /^\/coach\/([^/]+)(\/.*)?$/.exec(pathname || '')
  if (!m || !UUID_RE.test(m[1])) return { riderId: null, subPath: '' }
  const subPath = (m[2] || '').replace(/\/+$/, '')
  return { riderId: m[1].toLowerCase(), subPath }
}

export function athletePath(riderId, sub = '') {
  return `${COACH_HOME_PATH}/${riderId}${sub}`
}

/** Sidebar href of a nav item: athlete pages in athlete context, own pages otherwise. */
export function navHref(item, riderId) {
  if (riderId && Object.prototype.hasOwnProperty.call(ATHLETE_NAV, item.key)) {
    return athletePath(riderId, ATHLETE_NAV[item.key])
  }
  return item.href
}

/** Active state of a nav item (athlete routes only highlight their athlete-aware items). */
export function isContextNavActive(item, pathname, riderId) {
  if (!item.href) return false
  if (riderId) {
    const href = navHref(item, riderId)
    if (href === item.href) return false
    return pathname === href || pathname.startsWith(`${href}/`)
  }
  return item.exact ? pathname === item.href : pathname.startsWith(item.href)
}

const ATHLETE_ICONS = Object.freeze({
  overview: 'home',
  activities: 'bike',
  calendar: 'calendar',
  'pb-vault': 'trophy',
  templates: 'clipboard',
  physiology: 'settings',
})

/**
 * Sidebar / mobile drawer items. Outside athlete context: the coach's own items. In athlete context
 * ONLY athlete-scoped pages (plus a way back to the coach dashboard); every item of the coach's own
 * pages (telemetry, tools, feedback, own settings...) is hidden so nothing silently exits the context.
 */
export function sidebarItems(navItems, riderId) {
  if (!riderId) return navItems
  return [
    ...ATHLETE_PAGES.map((p) => ({
      key: p.key,
      label: p.label,
      icon: ATHLETE_ICONS[p.key] || 'home',
      href: athletePath(riderId, p.sub),
      exact: !p.sub,
    })),
    { key: 'coach-home', label: 'Coach dashboard', icon: 'users', href: COACH_HOME_PATH, exact: true, leavesContext: true },
  ]
}

/** Active state for sidebarItems() entries. */
export function isSidebarItemActive(item, pathname) {
  if (!item.href) return false
  if (item.key === 'coach-home') return false
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
}

/** Which global chrome pieces to show. In athlete context the coach's own tools are hidden. */
export function chromeVisibility(riderId) {
  const own = !riderId
  return {
    search: own,
    addSession: own,
    notifications: own,
    footerLinks: own,
    adminLink: own,
    mySettings: own,
    help: own,
  }
}

/** Where the logo goes: the athlete overview in athlete context, own home otherwise. */
export function logoHref(riderId) {
  return riderId ? athletePath(riderId) : '/'
}

/** Activity detail href that keeps the athlete context. */
export function activityHref(id, riderId) {
  return riderId ? athletePath(riderId, `/activities/${id}`) : `/activities/${id}`
}

/** "Back" target of the activity detail page. */
export function activityBackHref(riderId) {
  return riderId ? athletePath(riderId, '/activities') : '/'
}

/** Keeps in-page links of reused components in the athlete context. */
export function contextualHref(href, riderId) {
  if (!riderId || typeof href !== 'string') return href
  const m = /^\/activities\/([^/?#]+)$/.exec(href)
  return m ? athletePath(riderId, `/activities/${m[1]}`) : href
}

/** Banner text for athlete context. */
export function bannerText(name) {
  return `Coaching: ${name || 'athlete'}`
}

/** "Viewing as" options: Me plus athletes. Athletes only show when the user has any. */
export function viewingAsOptions(athleteRows, userId, names = {}) {
  const athletes = (athleteRows || [])
    .filter((r) => r.coach_id === userId && r.status === 'active')
    .map((r) => ({
      riderId: r.rider_id,
      label: names[r.rider_id] || 'Athlete',
      href: athletePath(r.rider_id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return { athletes, hasAthletes: athletes.length > 0 }
}

// ---- Dashboard formatting --------------------------------------------------------------

/** "today", "3 days ago", ... for the last-activity column. `now` is injectable for tests. */
export function formatLastActivity(iso, now = new Date()) {
  if (!iso) return 'No activity yet'
  const days = Math.floor((new Date(now).getTime() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 60) return `${days} days ago`
  return `${Math.floor(days / 30)} months ago`
}

/** "5h 20m" from seconds. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

/** "123.4 km" from metres. */
export function formatDistanceKm(meters) {
  return `${((Number(meters) || 0) / 1000).toFixed(1)} km`
}

/** Display-ready weekly volume summary of a coach_dashboard() row. */
export function weeklyVolume(row) {
  return {
    sessions: Number(row?.week_count) || 0,
    duration: formatDuration(row?.week_moving_time_s),
    distance: formatDistanceKm(row?.week_distance_m),
    load: Math.round(Number(row?.week_training_load) || 0),
  }
}

// ---- Audit trail wording ---------------------------------------------------------------

const TABLE_LABELS = Object.freeze({
  ftp_history: 'FTP',
  weight_history: 'weight',
  lactate_threshold_history: 'lactate thresholds',
  power_zone_history: 'training zones',
  profiles: 'training defaults',
})
const ACTION_VERBS = Object.freeze({ INSERT: 'added', UPDATE: 'updated', DELETE: 'removed' })

/** One-line description of a coach_edits row: "Amy updated FTP · 2026-06-10". */
export function describeCoachEdit(edit, coachName) {
  const what = TABLE_LABELS[edit?.table_name] || 'settings'
  const verb = ACTION_VERBS[String(edit?.action || '').toUpperCase()] || 'changed'
  const date = edit?.created_at ? new Date(edit.created_at).toISOString().slice(0, 10) : null
  return `${coachName || 'Your coach'} ${verb} ${what}${date ? ` · ${date}` : ''}`
}
