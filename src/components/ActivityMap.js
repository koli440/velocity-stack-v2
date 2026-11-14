'use client'

import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { mapTiles, isRetina } from '@/lib/mapTiles'
import Icon from './Icon'
import { routeSegments } from '@/lib/routeMapSharing'

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
  iconSize: [32, 52],
  iconAnchor: [16, 52],
  popupAnchor: [1, -44],
  shadowSize: [52, 52],
  className: 'hue-rotate-[90deg] drop-shadow-md', // greenish hue for the start
})

const finishIcon = new AltIcon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [32, 52],
  iconAnchor: [16, 52],
  popupAnchor: [1, -44],
  shadowSize: [52, 52],
  className: 'drop-shadow-md',
})

export default function ActivityMap({ latitude = [], longitude = [] }) {
  // Continuous segments only: samples hidden by a privacy zone (null) must not be bridged by a line.
  const tiles = mapTiles({ retina: isRetina() })
  const segments = routeSegments(latitude, longitude)
  if (!segments.length) return null
  const points = segments.flat()
  const start = points[0]
  const finish = points[points.length - 1]

  // Bounding box around the entire route for the default map zoom
  const bounds = L.latLngBounds(points)

  return (
    <div className="glass-dense h-[420px] md:h-[520px] w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-surface-darkBorder shadow-xs relative z-0">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [16, 16] }}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', background: '#e8eef4' }}
      >
        <TileLayer
          attribution={tiles.attribution}
          url={tiles.url}
          maxZoom={tiles.maxZoom}
          tileSize={tiles.tileSize}
          zoomOffset={tiles.zoomOffset}
          alt="Map tile"
        />
        <Polyline positions={segments} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }} />
        <Polyline positions={segments} pathOptions={{ color: '#ea580c', weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round' }} />
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
