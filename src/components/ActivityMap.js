'use client'

import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Vlastní ikony pro start / cíl trasy
const startIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: 'hue-rotate-[90deg]', // nazelenalý odstín pro start
})

const finishIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

export default function ActivityMap({ latitude = [], longitude = [] }) {
  // Sestavení pole [lat, lng] bodů; vyřadíme nevalidní/nulové souřadnice (0,0)
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

  // Bounding box okolo celé trasy pro výchozí přiblížení mapy
  const bounds = L.latLngBounds(points)

  return (
    <div className="h-[380px] w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-surface-darkBorder shadow-xs relative z-0">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [24, 24] }}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', background: '#0F172A' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <Polyline positions={points} pathOptions={{ color: '#f97316', weight: 4, opacity: 0.9 }} />
        <Marker position={start} icon={startIcon}>
          <Popup>
            <div className="text-slate-900 text-xs font-bold">🏁 Start</div>
          </Popup>
        </Marker>
        <Marker position={finish} icon={finishIcon}>
          <Popup>
            <div className="text-slate-900 text-xs font-bold">🏁 Finish</div>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  )
}
