import { SITE_URL, PUBLIC_PATHS } from '../lib/seo'
import { isIndexableTrack } from '../lib/trackSlug'
import { loadPublicTracks } from '../lib/server/publicTracks'
import { loadNews } from '../lib/server/newsContent'
import fs from 'node:fs'
import path from 'node:path'

export const revalidate = 3600

// Static pages: lastmod = file mtime (deploy time on a fresh build); /whats-new = newest news entry.
const SOURCES = {
  '/': 'src/app/page.js',
  '/how-it-works': 'src/app/how-it-works/page.js',
  '/about': 'src/app/about/page.js',
  '/dsl-guide': 'src/app/dsl-guide/page.js',
  '/import-help': 'src/app/import-help/page.js',
  '/gears': 'src/app/gears/page.js',
  '/pursuit': 'src/app/pursuit/page.js',
  '/track': 'src/app/track/page.js',
  '/velodromes': 'src/app/velodromes/page.js',
}

function mtime(rel) {
  try {
    return fs.statSync(path.join(process.cwd(), rel)).mtime
  } catch {
    return new Date()
  }
}

export default async function sitemap() {
  const news = loadNews()
  const newest = news[0]?.date ? new Date(news[0].date) : new Date()
  const tracks = (await loadPublicTracks()).filter(isIndexableTrack)

  const pages = PUBLIC_PATHS.map((p) => ({
    url: p === '/' ? SITE_URL : `${SITE_URL}${p}`,
    lastModified: p === '/whats-new' ? newest : SOURCES[p] ? mtime(SOURCES[p]) : new Date(),
    changeFrequency: p === '/whats-new' ? 'weekly' : 'monthly',
    priority: p === '/' ? 1 : 0.6,
  }))
  const trackPages = tracks.map((t) => ({
    url: `${SITE_URL}/velodromes/${t.slug}`,
    lastModified: t.created_at ? new Date(t.created_at) : new Date(),
    changeFrequency: 'monthly',
    priority: 0.5,
  }))
  return [...pages, ...trackPages]
}
