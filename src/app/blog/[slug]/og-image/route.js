import { ImageResponse } from 'next/og'
import { notFound } from 'next/navigation'
import { getPublishedPost } from '../../../../lib/server/blogContent'
import { formatPostDate } from '../../../../lib/blog'
import { OG_SIZE } from '../../../../lib/ogImage'
import CoverArt, { COVER_BACKGROUND } from '../../../../components/blog/CoverArt'

// Default 1200x630 share image for posts without a cover (generated CoverArt, same artwork as the feed card).
export const revalidate = 900

export async function GET(_req, { params }) {
  const post = getPublishedPost(params.slug)
  if (!post) notFound()
  const size = post.title.length > 70 ? 56 : 68
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          position: 'relative',
          background: COVER_BACKGROUND,
          color: '#ffffff',
        }}
      >
        <CoverArt />
        <div style={{ display: 'flex', fontSize: 48, fontWeight: 900, position: 'relative' }}>
          Velocity<span style={{ color: '#fb923c' }}>Stack</span>
          <span style={{ marginLeft: 20, color: '#e2e8f0', fontWeight: 500 }}>Blog</span>
        </div>
        <div style={{ display: 'flex', fontSize: size, fontWeight: 900, lineHeight: 1.15, position: 'relative', maxWidth: 900, textShadow: '0 2px 16px rgba(2,6,23,0.8)' }}>{post.title}</div>
        <div style={{ display: 'flex', fontSize: 30, color: '#e2e8f0', position: 'relative' }}>
          koli440 · {formatPostDate(post.date)}
        </div>
      </div>
    ),
    OG_SIZE,
  )
}
