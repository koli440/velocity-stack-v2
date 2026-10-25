import { SITE_URL, PUBLIC_PATHS } from '../lib/seo'

export default function sitemap() {
  return PUBLIC_PATHS.map((path) => ({
    url: path === '/' ? SITE_URL : `${SITE_URL}${path}`,
    changeFrequency: path === '/whats-new' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : 0.6,
  }))
}
