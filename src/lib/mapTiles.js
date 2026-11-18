const KEY = process.env.NEXT_PUBLIC_MAP_TILES_KEY

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'

if (!KEY && typeof console !== 'undefined') {
  console.warn(
    'NEXT_PUBLIC_MAP_TILES_KEY is not set; falling back to OpenStreetMap standard tiles.'
  )
}

// tileSize/zoomOffset are always defined: passing undefined to Leaflet overrides its defaults and causes "infinite number of tiles".
// Always the light MapTiler style (readable in both app themes). 512px tiles (zoomOffset -1) render labels
// sharper than 256px ones; `retina` requests the @2x variant. Without a key: OSM.
export function mapTiles({ key = KEY, retina = false } = {}) {
  if (!key) {
    return { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTRIBUTION, maxZoom: 19, tileSize: 256, zoomOffset: 0 }
  }
  return {
    url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}${retina ? '@2x' : ''}.png?key=${key}`,
    attribution: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ' + OSM_ATTRIBUTION,
    maxZoom: 20,
    tileSize: 512,
    zoomOffset: -1,
  }
}

export function isRetina() {
  return typeof window !== 'undefined' && window.devicePixelRatio > 1
}
