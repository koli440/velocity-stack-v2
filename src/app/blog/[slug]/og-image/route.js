import { ImageResponse } from 'next/og'
import { notFound } from 'next/navigation'
import { getPublishedPost } from '../../../../lib/server/blogContent'
import { formatPostDate } from '../../../../lib/blog'
import { OG_SIZE } from '../../../../lib/ogImage'

// Default 1200x630 share image for posts without a cover (same look as the site-wide opengraph-image).
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
          background: 'linear-gradient(135deg, #020617 0%, #0f172a 100%)',
          color: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', fontSize: 40, fontWeight: 800 }}>
          Velocity<span style={{ color: '#39ff14' }}>Stack</span>
          <span style={{ marginLeft: 20, color: '#94a3b8', fontWeight: 400 }}>Blog</span>
        </div>
        <div style={{ display: 'flex', fontSize: size, fontWeight: 800, lineHeight: 1.15 }}>{post.title}</div>
        <div style={{ display: 'flex', fontSize: 30, color: '#94a3b8' }}>
          koli440 · {formatPostDate(post.date)}
        </div>
      </div>
    ),
    OG_SIZE,
  )
}
