// Web Push helpers shared by the browser and the server (pure, no I/O).

import { describeNotification, notificationHref } from './notifications.js'

export const PUSH_TITLE = 'Velocity Stack'
export const PUSH_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const PUSH_TTL_S = 24 * 60 * 60

/** Short, non-sensitive payload: generic title, the same one-line text as the bell, and the same deep link. */
export function buildPushPayload(notification, actor) {
  const name = actor ? actor.display_name || actor.nickname || [actor.first_name, actor.last_name].filter(Boolean).join(' ') || null : null
  const body = describeNotification(notification, name ? { display_name: name } : null)
  return {
    title: PUSH_TITLE,
    body: body.slice(0, 140),
    url: safePushUrl(notificationHref(notification)),
    tag: notification?.id ? `n-${notification.id}` : undefined,
  }
}

/** Only same-origin relative paths are allowed as notification targets. */
export function safePushUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/'
  return path.slice(0, 500)
}

export function testPushPayload() {
  return { title: PUSH_TITLE, body: 'Test notification: push is working on this device.', url: '/settings', tag: 'test' }
}

/** True when a notification is too old to be worth a pop-up (e.g. after an outage). */
export function isPushStale(createdAt, now = Date.now()) {
  const t = Date.parse(createdAt)
  return !Number.isFinite(t) || now - t > PUSH_MAX_AGE_MS
}

/** Normalises a browser PushSubscription (or its toJSON()) for save_push_subscription; null when invalid. */
export function validateSubscription(sub) {
  const json = sub && typeof sub.toJSON === 'function' ? sub.toJSON() : sub
  const endpoint = json?.endpoint
  const p256dh = json?.keys?.p256dh
  const auth = json?.keys?.auth
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2048) return null
  const b64 = /^[A-Za-z0-9_-]+={0,2}$/
  if (typeof p256dh !== 'string' || !b64.test(p256dh) || p256dh.length > 256) return null
  if (typeof auth !== 'string' || !b64.test(auth) || auth.length > 128) return null
  return { endpoint, p256dh, auth }
}

/** Short device label from a user agent string. */
export function deviceLabel(ua) {
  const s = String(ua || '')
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : 'Unknown OS'
  const browser = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Browser'
  return `${browser} on ${os}`
}

/** VAPID public key (URL-safe base64) to the Uint8Array that pushManager.subscribe expects. */
export function urlBase64ToBytes(base64) {
  const padded = String(base64).trim().replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(base64).trim().length / 4) * 4, '=')
  const raw = atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/**
 * What the settings toggle should show.
 * env: { hasKey, hasPush (SW+PushManager+Notification), isIOS, standalone, permission }
 * @returns {'hidden'|'ios-install'|'unsupported'|'blocked'|'available'}
 */
export function pushSupportState({ hasKey, hasPush, isIOS, standalone, permission }) {
  if (!hasKey) return 'hidden'
  if (isIOS && !standalone) return 'ios-install'
  if (!hasPush) return 'unsupported'
  if (permission === 'denied') return 'blocked'
  return 'available'
}
