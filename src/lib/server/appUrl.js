// src/lib/server/appUrl.js
// Public origin of this deployment (works behind the hosting proxy).

export function appOrigin(req) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  if (!host) return new URL(req.url).origin
  const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`
}
