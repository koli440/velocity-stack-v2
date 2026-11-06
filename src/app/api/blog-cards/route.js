import { NextResponse } from 'next/server'
import { loadPublishedPosts, authorAvatar } from '../../../lib/server/blogContent'
import { feedCardData } from '../../../lib/blog'

// Published posts as feed-card data. Public content only (no rider data, no secrets). Rendered per request (not
// prerendered at build, where the avatar lookup could fail and be frozen as "no avatar"); the CDN caches only
// successful, avatar-complete responses for 5 minutes, so a missing avatar is retried on the next request.
export const dynamic = 'force-dynamic'

export async function GET() {
  const avatar = await authorAvatar(fetch, process.env, { fresh: true })
  const cards = loadPublishedPosts().map((p) => feedCardData(p, avatar))
  return NextResponse.json(
    { cards },
    { headers: { 'Cache-Control': avatar ? 'public, s-maxage=300, stale-while-revalidate=600' : 'no-store' } },
  )
}
