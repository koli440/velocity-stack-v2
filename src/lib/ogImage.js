import { ImageResponse } from 'next/og'

export const OG_SIZE = { width: 1200, height: 630 }
export const OG_ALT = 'VelocityStack: velodrome telemetry platform for track cyclists'

export function renderOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: 'linear-gradient(135deg, #020617 0%, #0f172a 100%)',
          color: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', fontSize: 96, fontWeight: 800 }}>
          Velocity<span style={{ color: '#39ff14' }}>Stack</span>
        </div>
        <div style={{ display: 'flex', fontSize: 44, marginTop: 24, color: '#cbd5e1' }}>
          Velodrome telemetry for track cyclists
        </div>
        <div style={{ display: 'flex', fontSize: 30, marginTop: 40, color: '#94a3b8' }}>
          Speed, cadence and power analysis
        </div>
      </div>
    ),
    OG_SIZE
  )
}
