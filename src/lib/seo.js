// Shared SEO constants/helpers. Canonical host has no "www".
export const SITE_URL = 'https://velocity-stack.app'
export const SITE_NAME = 'VelocityStack'
export const SITE_DESCRIPTION =
  'Pure speed, cadence & power durational analysis for track cyclists: velodrome telemetry, power profiles, interval templates and coaching.'

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
  '/pursuit',
  '/report-bug',
  '/riders',
  '/templates',
  '/velodromes',
]

export const PUBLIC_PATHS = ['/', '/about', '/dsl-guide', '/whats-new', '/import-help', '/gears', '/privacy', '/terms']
