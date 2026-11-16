import { ImageResponse } from 'next/og'
import { renderOgImage } from './ogImage'
import { accentOf } from './coachCard'

export const COACH_OG_ALT = 'Coach on VelocityStack'

// Text-only 1200x630 card (no remote avatar fetch); falls back to the generic site card for unknown slugs.
export function renderCoachCardOg(card) {
  if (!card) return renderOgImage()
  const accent = accentOf(card.accent)
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '70px', background: '#020617', color: '#fff', borderTop: `18px solid ${accent.hex}` }}>
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
