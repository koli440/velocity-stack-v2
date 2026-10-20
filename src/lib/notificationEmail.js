// Email copy for in-app notifications (sent by POST /api/notifications/email/run).

import { describeNotification, notificationHref } from './notifications.js'

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function profileName(p) {
  if (!p) return null
  return p.nickname || [p.first_name, p.last_name].filter(Boolean).join(' ') || null
}

/** @returns {{ subject: string, text: string, html: string }} */
export function buildNotificationEmail(notification, actor, origin) {
  const message = describeNotification(notification, actor ? { display_name: profileName(actor) } : null)
  const path = notificationHref(notification) || '/'
  const url = `${origin.replace(/\/$/, '')}${path}`
  const settings = `${origin.replace(/\/$/, '')}/settings`
  return {
    subject: `Velocity Stack: ${message}`,
    text: `${message}\n\nOpen it: ${url}\n\nTurn off these emails in ${settings}`,
    html:
      `<p>${escapeHtml(message)}</p>` +
      `<p><a href="${escapeHtml(url)}">Open in Velocity Stack</a></p>` +
      `<p style="color:#888;font-size:12px">Turn off these emails in <a href="${escapeHtml(settings)}">settings</a>.</p>`,
  }
}

/** Sends through Resend's HTTP API. Returns false when no provider is configured. */
export async function sendEmail({ to, subject, text, html }, env = process.env, fetchImpl = fetch) {
  const key = env.RESEND_API_KEY
  if (!key) return false
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || 'Velocity Stack <onboarding@resend.dev>', to: [to], subject, text, html }),
  })
  if (!res.ok) throw new Error(`mail provider responded ${res.status}`)
  return true
}
