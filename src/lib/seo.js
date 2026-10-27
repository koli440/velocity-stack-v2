// Shared SEO constants/helpers. Canonical host has no "www".
export const SITE_URL = 'https://velocity-stack.app'
export const SITE_NAME = 'VelocityStack'
export const SITE_DESCRIPTION =
  'Pure speed, cadence & power durational analysis for track cyclists: velodrome telemetry, power profiles, interval templates and coaching.'

export const TITLE_SUFFIX = ` | ${SITE_NAME}`
export const MAX_TITLE = 60
export const MAX_DESCRIPTION = 155

// Truncate at a word boundary with an ellipsis so `text` fits in `max` chars.
export function truncateWords(text, max) {
  const s = String(text || '').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  const base = (sp >= Math.floor(max / 3) ? cut.slice(0, sp) : cut).replace(/[\s,;:(\-–]+$/, '')
  return `${base}…`
}

// Page title (before the layout's ' | VelocityStack' template) so the final title is <= 60 chars.
export const fitTitle = (title) => truncateWords(title, MAX_TITLE - TITLE_SUFFIX.length)

export function trackTitle(name, country) {
  const budget = MAX_TITLE - TITLE_SUFFIX.length
  let tail = ` velodrome${country ? `, ${country}` : ''}`
  // Very long country names: drop the country rather than crush the track name.
  if (budget - tail.length < 16) tail = ' velodrome'
  return `${truncateWords(name, budget - tail.length)}${tail}`
}

export const fitDescription = (d) => truncateWords(d, MAX_DESCRIPTION)

// Private/authenticated pages: keep out of search results.
export const noindex = (title, description) => ({
  title,
  ...(description ? { description } : {}),
  alternates: { canonical: null },
  robots: { index: false, follow: false },
})

// Public pages: unique title/description plus a canonical URL.
export const publicPage = (path, title, description) => ({
  title,
  description,
  alternates: { canonical: path },
  openGraph: { type: 'website', siteName: SITE_NAME, title, description, url: path },
})

export const PRIVATE_PATHS = [
  '/api/',
  '/admin/',
  '/settings',
  '/auth/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/activities/',
  '/aero-lab',
  '/calendar',
  '/coach/',
  '/feedback',
  '/fitness',
  '/pb-vault',
  '/report-bug',
  '/riders',
  '/templates',
]

export const PUBLIC_PATHS = ['/', '/how-it-works', '/about', '/dsl-guide', '/whats-new', '/velodromes', '/import-help', '/gears', '/pursuit', '/track', '/privacy', '/terms']
