# PWA (installable app)

- Manifest: `src/app/manifest.js`; icons in `public/icons/` (192, 512, maskable derived from `src/app/icon.png`).
- Metadata (`appleWebApp`, `viewport-fit=cover`, theme color) lives in `src/app/layout.js`; the body uses safe-area padding.
- Service worker: `public/sw.js`, registered in production only by `ServiceWorkerRegister`. It caches only `/_next/static`, `/icons` and fonts (cache names are versioned; old ones are deleted on activate) and serves `public/offline.html` when a navigation fails. HTML, `/api/*`, cross-origin (Supabase) and auth routes (`/auth`, `/login`, `/register`, `/forgot-password`, `/reset-password`) are never cached. Bump `VERSION` in `sw.js` when changing caching.
- `/sw.js` is served with `Cache-Control: no-cache` via `next.config.js`.
- Kill switch: visit `/?sw-off=1` to unregister the worker and clear caches locally, or set `KILL_SWITCH = true` in `sw.js` and deploy to self-unregister all clients.
