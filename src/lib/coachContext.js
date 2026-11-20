// Athlete ("Viewing as") context for coaches. The context lives ONLY in the URL
// (/coach/<riderId>/...); nothing is stored. Access is enforced by the database (is_coach_of),
// this module just derives the context and builds hrefs.

import { labBasePath, labMenuChildren } from './labFeatures.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const COACH_HOME_PATH = '/coach'

// Extra athlete-only pages that have no sidebar entry of their own in the coach's context.
export const ATHLETE_PAGES = Object.freeze([
  { key: 'overview', label: 'Overview', sub: '' },
  { key: 'activities', label: 'Activities', sub: '/activities' },
  { key: 'calendar', label: 'Calendar', sub: '/calendar' },
  { key: 'fitness', label: 'Fitness', sub: '/fitness' },
  { key: 'pb-vault', label: 'Personal Bests', sub: '/pb-vault' },
  { key: 'templates', label: 'Templates', sub: '/templates' },
  { key: 'physiology', label: 'Physiology', sub: '/physiology' },
  // The lab is not part of the flagged coach business layer: any coach/athlete relationship may use it.
  { key: 'lab', label: 'Lab', sub: '/lab' },
])

// Pages of the coach module (behind the `coach_module` feature flag, see docs/coaching.md).
export const COACH_MODULE_PAGES = Object.freeze([
  { key: 'notes', label: 'Notes', sub: '/notes' },
])

/** Athlete tab/sidebar pages; module pages only when the signed-in user has the coach module. */
export function athletePages(moduleEnabled = false) {
  return moduleEnabled ? [...ATHLETE_PAGES, ...COACH_MODULE_PAGES] : ATHLETE_PAGES
}

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

/** The coach-side thread with this athlete (not ended), if the conversation list has one. */
export function athleteThread(threads, riderId) {
  return (threads || []).find((x) => x.role === 'coach' && String(x.other_id) === String(riderId) && x.status !== 'ended') || null
}

/** Messages of this athlete stay inside the athlete context: /coach/<riderId>/chat renders the thread with them. */
export const athleteChatPath = (riderId) => athletePath(riderId, '/chat')

/**
 * Menu tree of the athlete context (same accordion rules as the main menu): a "Viewing <name>" header, Overview,
 * Training (Activities, Calendar, Fitness, Templates), Personal Bests, Physiology, Lab (features under section labels),
 * Notes (coach module), Planner (macro planner flag), Messages with this athlete (unread badge of that thread) and the way back to the dashboard.
 */
export function buildAthleteTree(riderId, athleteName, moduleEnabled = false, threads = [], plannerEnabled = false) {
  const leaf = (key, label, icon, sub, extra = {}) => ({ key, label, icon, href: athletePath(riderId, sub), exact: !sub, ...extra })
  const sub = (key, label, path) => ({ key, label, href: athletePath(riderId, path) })
  const labBase = labBasePath(riderId)
  const tree = [
    { key: 'athlete', type: 'header', label: `Viewing ${athleteName || 'athlete'}` },
    leaf('overview', 'Overview', 'home', ''),
    {
      key: 'training', type: 'group', label: 'Training', icon: 'calendar', matches: [],
      children: [sub('activities', 'Activities', '/activities'), sub('calendar', 'Calendar', '/calendar'), sub('fitness', 'Fitness', '/fitness'), sub('templates', 'Templates', '/templates')],
    },
    leaf('pb-vault', 'Personal Bests', 'trophy', '/pb-vault'),
    leaf('physiology', 'Physiology', 'settings', '/physiology'),
    // The lab is not part of the flagged coach business layer: any coach/athlete relationship may use it.
    { key: 'lab', type: 'group', label: 'Lab', icon: 'flask', matches: [labBase], children: labMenuChildren(labBase) },
  ]
  if (moduleEnabled) tree.push(leaf('notes', 'Notes', 'clipboard', '/notes'))
  // Macro planner: only with its own `macro_planner` flag (docs/macro-planner.md).
  if (plannerEnabled) tree.push(leaf('planner', 'Planner', 'trend', '/planner'))
  tree.push(
    { key: 'messages', label: 'Messages', icon: 'chat', href: athleteChatPath(riderId), unread: Number(athleteThread(threads, riderId)?.unread) || 0 },
    { key: 'coach-home', label: 'Coach dashboard', icon: 'users', href: COACH_HOME_PATH, exact: true, leavesContext: true },
  )
  return tree
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
    gymSessions: Number(row?.week_gym_count) || 0,
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

// Athlete pages whose data queries only need the rider id (access is enforced by RLS), so they can
// start loading while the layout still verifies the coaching relationship. Pages that need the
// athlete profile itself (overview, physiology) wait for it.
const EAGER_SUBPATHS = Object.freeze(['/activities', '/calendar', '/fitness', '/pb-vault', '/templates'])

export function rendersBeforeAthleteLoaded(subPath) {
  const p = String(subPath || '').replace(/\/+$/, '')
  return EAGER_SUBPATHS.some((s) => p === s || p.startsWith(`${s}/`))
}
