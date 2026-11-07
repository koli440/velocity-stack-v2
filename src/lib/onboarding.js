// Onboarding copy (welcome tour) and the getting-started checklist rules (issue #244).
// English only. Checklist progress is never stored: it is derived from the rider's real data.

import { scopeToOwner } from './ownerScope.js'

export const OPEN_WELCOME_EVENT = 'velocity:open-welcome'

// Welcome tour. Body text supports lib/markdownLite.js. `links` are shown as buttons under the text.
export const WELCOME_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Velocity Stack',
    body: `Velocity Stack analyses your rides against **templates** you define, tracks your personal bests and helps you plan training, alone or with a coach.

This short tour takes about a minute. You can skip it now and reopen it any time from **Help** in the top-right menu.`,
  },
  {
    id: 'data',
    title: 'Get your rides in',
    body: `Connect **Garmin**, **Wahoo**, **SRM**, **Intervals.icu** or **Strava**, in that order of preference, and your rides sync automatically, or upload FIT files by hand with **Add / Sync** at the top. SRM has no cloud sync: import its .fit files. Zwift and MyWhoosh rides arrive through Intervals.icu.

- Pick how far back to import when you connect.
- Rides you already have are not duplicated.`,
    links: [{ label: 'Connect a data source', href: '/connections' }],
  },
  {
    id: 'physiology',
    title: 'Set your FTP and weight',
    body: `FTP and weight drive power zones, intensity, load and every W/kg figure. Add them in **Settings**, with the date they apply from. Each ride keeps the values that were valid on its day, so history stays correct when they change.`,
    links: [{ label: 'Open settings', href: '/settings' }],
  },
  {
    id: 'features',
    title: 'What you can do',
    body: `- **Dashboard:** your sessions, this week's numbers and your power profile.
- **Calendar:** rides, runs and gym sessions with their training load, plus planned workouts, notes and races.
- **Fitness:** fitness, fatigue and form over time, with a forecast.
- **Personal Best Vault:** every best, by distance and discipline.
- **Gear Architect, Pursuit Strategist, Aero Lab, Velodromes:** track tools you can try without any data of your own.
- **Riders:** follow other riders, comment and give respect.`,
    links: [{ label: 'Open the calendar', href: '/calendar' }],
  },
  {
    id: 'plan',
    title: 'Plan and follow your training',
    body: `Add a **planned workout** on any day of the calendar, with steps if you like, or build it from a template.

- Ride and track workouts with steps can be sent to **Garmin**, **Wahoo** or **Intervals.icu** from the workout, or automatically if you switch that on for the connection.
- A completed ride is matched to its plan, so you see planned against done, per day, week and month.
- Gym sessions and runs count towards your training load too.`,
    links: [{ label: 'Open the calendar', href: '/calendar' }],
  },
  {
    id: 'templates',
    title: 'Template analysis',
    body: `Templates are what make Velocity Stack different. A template describes the efforts you care about in plain text, for example:

\`\`\`
6x
work 30sec @ >400W
recovery 90sec @ <150W
\`\`\`

- **Run a template on a ride** from its page: the efforts are found, validated against the plan and measured.
- **Results add up:** each template keeps statistics over all your runs, so you can see progress over time.
- **Send an effort to the Personal Best Vault** straight from a run.
- Start with the ready-made track templates, or write your own with the syntax guide.`,
    links: [
      { label: 'Browse templates', href: '/templates' },
      { label: 'Template syntax guide', href: '/dsl-guide' },
    ],
  },
  {
    id: 'coaching',
    title: 'Coaching',
    body: `Any account can coach, or be coached. A rider has at most one coach, and accepting the invitation is the consent.

- A coach can read your data and edit your FTP, weight and training settings. Changes are labelled **set by coach**, and you are notified.
- Coaches can plan workouts and races on your calendar and follow your fitness and training load.
- You can end coaching at any time.`,
    links: [{ label: 'Coaching settings', href: '/settings' }],
  },
  {
    id: 'privacy',
    title: 'Notifications, privacy and the app',
    body: `You decide who sees what.

- Set a **privacy zone** around home: rides are masked inside it for other riders.
- Your raw GPS file and your connection keys are never shared.
- Coaches can see your data only while coaching is active.

Install Velocity Stack as an app (add it to your Home Screen on iPhone) and turn on **pop-up notifications** in Settings to be told about followers, comments and coaching, even when the app is closed.`,
    links: [{ label: 'Open settings', href: '/settings' }],
  },
]

// Checklist: `done(facts)` reads facts derived from the database (see fetchOnboardingFacts).
export const CHECKLIST_ITEMS = [
  { id: 'source', label: 'Connect a data source', hint: 'Garmin, Wahoo, SRM, Intervals.icu or Strava', href: '/connections', done: (f) => f.hasConnection },
  { id: 'ride', label: 'Import your first ride', hint: 'Sync, or upload a FIT file', href: '/', done: (f) => f.activityCount > 0 },
  { id: 'ftp', label: 'Set your FTP', hint: 'Drives zones and intensity', href: '/settings#physiology', done: (f) => f.hasFtp },
  { id: 'weight', label: 'Set your weight', hint: 'Drives every W/kg figure', href: '/settings#physiology', done: (f) => f.hasWeight },
  { id: 'template', label: 'Run a template on a ride', hint: 'Open a ride and pick a template', href: '/templates', done: (f) => f.templateRunCount > 0 },
  { id: 'privacy', label: 'Review your privacy zone', hint: 'Mask the area around home', href: '/settings', done: (f) => f.hasPrivacyZone },
]

export const EMPTY_FACTS = {
  hasConnection: false,
  activityCount: 0,
  hasFtp: false,
  hasWeight: false,
  templateRunCount: 0,
  hasPrivacyZone: false,
}

/** @returns {{ items: Array<{id,label,hint,href,done:boolean}>, doneCount: number, total: number, complete: boolean }} */
export function evaluateChecklist(facts) {
  const f = { ...EMPTY_FACTS, ...(facts || {}) }
  const items = CHECKLIST_ITEMS.map(({ done, ...item }) => ({ ...item, done: !!done(f) }))
  const doneCount = items.filter((i) => i.done).length
  return { items, doneCount, total: items.length, complete: doneCount === items.length }
}

/** The checklist card stays on the dashboard until it is complete or dismissed. */
export function shouldShowChecklist(state, checklist) {
  if (!state || state.onboarding_dismissed_at) return false
  return !checklist?.complete
}

/**
 * Own data only: every query is explicitly scoped to the signed-in user (RLS would also let an active
 * coach read their athletes' rows, which must never count towards the coach's own checklist).
 */
export async function fetchOnboardingFacts(supabase, userId) {
  const count = (table, extra) => {
    let q = scopeToOwner(supabase.from(table).select('id', { count: 'exact', head: true }), userId)
    if (extra) q = extra(q)
    return q
  }
  const [conn, acts, ftp, weight, runs, profile] = await Promise.all([
    count('connections', (q) => q.neq('status', 'disconnected')),
    count('activities'),
    count('ftp_history'),
    count('weight_history'),
    count('template_executions'),
    supabase.from('profiles').select('ftp_w, privacy_zone_lat, privacy_zone_lng').eq('id', userId).maybeSingle(),
  ])
  const p = profile?.data || {}
  return {
    hasConnection: (conn.count || 0) > 0,
    activityCount: acts.count || 0,
    hasFtp: (ftp.count || 0) > 0 || Number(p.ftp_w) > 0,
    hasWeight: (weight.count || 0) > 0,
    templateRunCount: runs.count || 0,
    hasPrivacyZone: p.privacy_zone_lat != null && p.privacy_zone_lng != null,
  }
}
