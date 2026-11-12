import { ImageResponse } from 'next/og'
import { OG_SIZE, renderOgImage } from './ogImage'
import { headlineStats } from './recap'

export const RECAP_OG_ALT = 'Velocity Stack season recap'

/** 1200x630 card for a shared recap; falls back to the generic site card when the link is unknown or revoked. */
export function renderRecapOg(shared) {
  if (!shared?.recap) return renderOgImage()
  const stats = headlineStats(shared.recap)
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '70px',
          background: 'linear-gradient(135deg, #020617 0%, #0f172a 100%)',
          color: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', fontSize: 36, color: '#39ff14', fontWeight: 800 }}>
          Velocity Stack · {shared.year} season recap
        </div>
        <div style={{ display: 'flex', fontSize: 80, fontWeight: 800, marginTop: 20 }}>{`${shared.name}'s ${shared.year}`}</div>
        <div style={{ display: 'flex', marginTop: 50 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', marginRight: 60 }}>
              <div style={{ display: 'flex', fontSize: 64, fontWeight: 800 }}>{s.value}</div>
              <div style={{ display: 'flex', fontSize: 28, color: '#94a3b8' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    OG_SIZE
  )
}
