import { ImageResponse } from 'next/og'
import { OG_SIZE, renderOgImage } from './ogImage'
import { headlineStats, monthlyBars, safeAvatarUrl } from './recap'
import { avatarInitials } from './avatars'
import { fetchAvatarDataUri } from './server/recapAvatar'

export const RECAP_OG_ALT = 'Velocity Stack season recap'

/** 1200x630 card for a shared recap; falls back to the generic site card when the link is unknown or revoked. */
export async function renderRecapOg(shared) {
  if (!shared?.recap) return renderOgImage()
  const avatar = await fetchAvatarDataUri(safeAvatarUrl(shared.avatar_url))
  try {
    return await buildRecapOg(shared, avatar)
  } catch {
    return avatar ? buildRecapOg(shared, null) : renderOgImage()
  }
}

function buildRecapOg(shared, avatar) {
  const stats = headlineStats(shared.recap).slice(0, 3)
  const bars = monthlyBars(shared.recap)
  const ring = { display: 'flex', width: 180, height: 180, borderRadius: 90, border: '6px solid #39ff14', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', background: '#1e293b' }
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '60px 70px',
          background: 'linear-gradient(135deg, #047857 0%, #0f172a 45%, #020617 100%)',
          color: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 34, color: '#39ff14', fontWeight: 800 }}>
              Velocity Stack · {shared.year} season recap
            </div>
            <div style={{ display: 'flex', fontSize: 76, fontWeight: 800, marginTop: 16 }}>{`${shared.name}'s ${shared.year}`}</div>
          </div>
          <div style={ring}>
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} width={180} height={180} alt="" style={{ objectFit: 'cover' }} />
            ) : (
              <div style={{ display: 'flex', fontSize: 72, fontWeight: 800, color: '#39ff14' }}>{avatarInitials(shared.name)}</div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: 40 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', marginRight: 60 }}>
              <div style={{ display: 'flex', fontSize: 64, fontWeight: 800 }}>{s.value}</div>
              <div style={{ display: 'flex', fontSize: 28, color: '#cbd5e1' }}>{s.label}</div>
            </div>
          ))}
        </div>
        {bars.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-end', height: 110, marginTop: 36 }}>
            {bars.map((b) => (
              <div
                key={b.month}
                style={{
                  display: 'flex',
                  flex: 1,
                  marginRight: 10,
                  height: `${Math.max(5, Math.round(b.height * 100))}%`,
                  background: b.peak ? '#39ff14' : 'rgba(255,255,255,0.35)',
                  borderRadius: 6,
                }}
              />
            ))}
          </div>
        )}
      </div>
    ),
    OG_SIZE
  )
}
