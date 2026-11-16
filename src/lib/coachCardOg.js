import { ImageResponse } from 'next/og'
import { renderOgImage } from './ogImage'
import { accentOf, safeCoachMediaUrl } from './coachCard'

export const COACH_OG_ALT = 'Coach on VelocityStack'

// A remote image that fails to load would fail the whole render, so it is probed first (short timeout) and left
// out of the card when it is not a reachable image.
async function reachableImage(url) {
  if (!url) return null
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2000) })
    return res.ok && /^image\/(jpeg|png|webp)/.test(res.headers.get('content-type') || '') ? url : null
  } catch {
    return null
  }
}

// 1200x630 card: text plus the coach's logo when it loads (no avatar fetch); falls back to the generic site card for unknown slugs.
export async function renderCoachCardOg(card) {
  if (!card) return renderOgImage()
  const logo = await reachableImage(safeCoachMediaUrl(card.logo_url))
  const accent = accentOf(card.accent)
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '70px', background: '#020617', color: '#fff', borderTop: `18px solid ${accent.hex}` }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" width={120} height={120} style={{ position: 'absolute', top: 50, right: 70, objectFit: 'contain', borderRadius: 16, background: '#fff' }} />
        ) : null}
        <div style={{ display: 'flex', fontSize: 34, color: accent.hex, fontWeight: 800 }}>Coach on VelocityStack</div>
        <div style={{ display: 'flex', fontSize: 84, fontWeight: 800, marginTop: 18 }}>{card.name}</div>
        {card.headline ? <div style={{ display: 'flex', fontSize: 40, marginTop: 18, color: '#cbd5e1' }}>{card.headline}</div> : null}
        <div style={{ display: 'flex', fontSize: 30, marginTop: 28, color: '#94a3b8' }}>
          {[card.location, (card.disciplines || []).join(' · ')].filter(Boolean).join('  |  ')}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
