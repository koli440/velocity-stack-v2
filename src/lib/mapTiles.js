const KEY = process.env.NEXT_PUBLIC_MAP_TILES_KEY

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'

if (!KEY && typeof console !== 'undefined') {
  console.warn(
    'NEXT_PUBLIC_MAP_TILES_KEY is not set; falling back to OpenStreetMap standard tiles.'
  )
}

export const MAP_TILES = KEY
  ? {
      url: `https://api.maptiler.com/maps/dataviz-dark/{z}/{x}/{y}.png?key=${KEY}`,
      attribution:
        '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ' + OSM_ATTRIBUTION,
      maxZoom: 20,
    }
  : {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19,
    }
