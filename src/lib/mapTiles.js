const KEY = process.env.NEXT_PUBLIC_MAP_TILES_KEY

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'

if (!KEY && typeof console !== 'undefined') {
  console.warn(
    'NEXT_PUBLIC_MAP_TILES_KEY is not set; falling back to OpenStreetMap standard tiles.'
  )
}

export function mapStyleFor(theme) {
  return theme === 'dark' ? 'dataviz-dark' : 'streets-v2'
}

// Tile layer props for the given resolved theme ('light' | 'dark'). MapTiler 512px tiles (zoomOffset -1)
// render labels sharper than 256px ones; `retina` requests the @2x variant. Without a key: OSM.
export function mapTilesFor(theme, { key = KEY, retina = false } = {}) {
  if (!key) {
    return { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTRIBUTION, maxZoom: 19 }
  }
  const style = mapStyleFor(theme)
  return {
    url: `https://api.maptiler.com/maps/${style}/{z}/{x}/{y}${retina ? '@2x' : ''}.png?key=${key}`,
    attribution: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ' + OSM_ATTRIBUTION,
    maxZoom: 20,
    tileSize: 512,
    zoomOffset: -1,
  }
}

export function isRetina() {
  return typeof window !== 'undefined' && window.devicePixelRatio > 1
}
