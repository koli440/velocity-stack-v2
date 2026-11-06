import { loadPublishedPosts } from '../../../lib/server/blogContent'
import { rssXml } from '../../../lib/blog'

export const revalidate = 900

export function GET() {
  return new Response(rssXml(loadPublishedPosts()), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
