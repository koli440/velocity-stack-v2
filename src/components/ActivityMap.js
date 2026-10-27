'use client'

import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { MAP_TILES } from '@/lib/mapTiles'
import Icon from './Icon'

// Leaflet renders the marker shadow with an empty alt; Bing flags that as missing
class AltIcon extends L.Icon {
  createShadow(oldIcon) {
    const el = super.createShadow(oldIcon)
    if (el) el.setAttribute('alt', 'Marker shadow')
    return el
  }
}

// Custom icons for the route's start / finish
const startIcon = new AltIcon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: 'hue-rotate-[90deg]', // greenish hue for the start
})

const finishIcon = new AltIcon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

export default function ActivityMap({ latitude = [], longitude = [] }) {
  // Build the array of [lat, lng] points; discard invalid/zero coordinates (0,0)
  const points = []
  const len = Math.min(latitude.length, longitude.length)
  for (let i = 0; i < len; i++) {
    const lat = latitude[i]
    const lng = longitude[i]
    if (typeof lat === 'number' && typeof lng === 'number' && (lat !== 0 || lng !== 0)) {
      points.push([lat, lng])
    }
  }

  if (points.length < 2) return null

  const start = points[0]
  const finish = points[points.length - 1]

  // Bounding box around the entire route for the default map zoom
  const bounds = L.latLngBounds(points)

  return (
    <div className="glass-dense h-[380px] w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-surface-darkBorder shadow-xs relative z-0">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [24, 24] }}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', background: '#0F172A' }}
      >
        <TileLayer
          attribution={MAP_TILES.attribution}
          url={MAP_TILES.url}
          maxZoom={MAP_TILES.maxZoom}
          alt="Map tile"
        />
        <Polyline positions={points} pathOptions={{ color: '#f97316', weight: 4, opacity: 0.9 }} />
        <Marker position={start} icon={startIcon}>
          <Popup>
            <div className="text-slate-900 text-xs font-bold"><Icon name="flag" /> Start</div>
          </Popup>
        </Marker>
        <Marker position={finish} icon={finishIcon}>
          <Popup>
            <div className="text-slate-900 text-xs font-bold"><Icon name="flag" /> Finish</div>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  )
}
