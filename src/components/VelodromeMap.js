'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Oprava výchozích ikon Leafletu pro Next.js bundler
const customIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
})

export default function VelodromeMap({ tracks = [] }) {
  // Vybereme pouze velodromy s platnými GPS souřadnicemi
  const validTracks = tracks.filter(t => t.latitude && t.longitude && !isNaN(t.latitude) && !isNaN(t.longitude))

  return (
    <div className="h-[420px] w-full rounded-xl overflow-hidden border border-track-line shadow-2xl relative z-0">
      <MapContainer
        center={[30.0, 10.0]}
        zoom={2}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', background: '#0F172A' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        {validTracks.map((track) => (
          <Marker
            key={track.id}
            position={[track.latitude, track.longitude]}
            icon={customIcon}
          >
            <Popup className="track-popup">
              <div className="text-slate-900 p-1">
                <div className="font-bold text-sm">{track.name}</div>
                <div className="text-xs text-slate-600 mb-1">
                  {track.country_code ? `[${track.country_code}] ` : ''}{track.surface} • {track.length_m} m
                </div>
                <div className="text-[11px] font-semibold text-orange-600">
                  {track.is_indoor ? '🏟️ Indoor' : '☀️ Outdoor'} • {track.elevation_m} m a.s.l.
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
