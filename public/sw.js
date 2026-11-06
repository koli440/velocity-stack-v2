// Minimal service worker: caches static assets only; offline fallback for navigations.
// Kill switch: set KILL_SWITCH = true (or visit /?sw-off=1) to unregister and clear caches.
const KILL_SWITCH = false
const VERSION = 'v2'
const STATIC_CACHE = `vs-static-${VERSION}`
const OFFLINE_CACHE = `vs-offline-${VERSION}`
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  if (KILL_SWITCH) return self.skipWaiting()
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((c) => c.add(new Request(OFFLINE_URL, { cache: 'reload' }))).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = KILL_SWITCH ? [] : [STATIC_CACHE, OFFLINE_CACHE]
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k)))
      if (KILL_SWITCH) {
        await self.registration.unregister()
        const clients = await self.clients.matchAll({ type: 'window' })
        clients.forEach((c) => c.navigate(c.url))
      } else {
        await self.clients.claim()
      }
    })()
  )
})

const STATIC_PATTERNS = [/^\/_next\/static\//, /^\/icons\//, /\.(?:woff2?|ttf|otf)$/]

self.addEventListener('fetch', (event) => {
  if (KILL_SWITCH) return
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // Supabase, analytics, etc.
  if (req.headers.has('authorization')) return

  if (req.mode === 'navigate') {
    // Network only; no HTML caching. Auth/OAuth/API routes are never touched beyond this fallback.
    if (/^\/(auth|login|register|forgot-password|reset-password|api)(\/|$)/.test(url.pathname)) return
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error())
    )
    return
  }

  if (STATIC_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      })
    )
  }
})

// Web Push: short payload {title, body, url, tag}; tapping opens (or focuses) the deep link.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = {} }
  const title = data.title || 'Velocity Stack'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || undefined,
      data: { url: typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin) {
          if ('navigate' in w) await w.navigate(target).catch(() => {})
          return w.focus()
        }
      }
      return self.clients.openWindow(target)
    })()
  )
})
