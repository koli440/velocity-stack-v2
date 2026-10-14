# Maps

Maps use Leaflet with MapTiler's `dataviz-dark` raster tiles (see `src/lib/mapTiles.js`).

Set `NEXT_PUBLIC_MAP_TILES_KEY` to a MapTiler API key in the hosting environment
(see `.env.example`). The key is public, so restrict it by domain in the MapTiler dashboard.
If unset, a console warning is logged and OpenStreetMap standard tiles are used.
