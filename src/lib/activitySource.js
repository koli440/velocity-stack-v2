// Where an activity came from, for the small source badge on feed cards and the activity detail.
const LABELS = { strava: 'Strava', garmin: 'Garmin', wahoo: 'Wahoo', intervals: 'Intervals.icu' }

/** 'partner:pedalmania' | 'garmin' | ... | null (manual/file uploads show no badge). */
export function importSourceKey(act) {
  if (!act) return null
  if (act.import_source) return act.import_source
  const ext = act.external_source
  if (typeof ext === 'string' && ext.startsWith('partner:')) return ext
  return act.source || null
}

function prettifySlug(slug) {
  return String(slug).split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}

/** @param {Record<string,string>} [appNames] slug -> app name of approved partner apps */
export function sourceBadgeLabel(act, appNames = {}) {
  const key = importSourceKey(act)
  if (!key) return null
  if (key.startsWith('partner:')) {
    const slug = key.slice('partner:'.length)
    return appNames[slug] || prettifySlug(slug) || 'Partner app'
  }
  return LABELS[key] || null
}
