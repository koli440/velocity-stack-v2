import { NextResponse } from 'next/server'
import { loadPublishedPosts, authorAvatar } from '../../../lib/server/blogContent'
import { feedCardData } from '../../../lib/blog'

// Published posts as feed-card data. Public content only (no rider data, no secrets); future-dated posts are
// filtered at render time and the response is refreshed at most every 15 minutes.
export const revalidate = 900

export async function GET() {
  const avatar = await authorAvatar()
  return NextResponse.json({ cards: loadPublishedPosts().map((p) => feedCardData(p, avatar)) })
}
