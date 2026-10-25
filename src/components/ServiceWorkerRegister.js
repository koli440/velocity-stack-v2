'use client'
import { useEffect } from 'react'

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('sw-off') === '1') {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))
      if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)))
      return
    }
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
  }, [])
  return null
}
