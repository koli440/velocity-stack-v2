import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildNotificationEmail, sendEmail } from '../notificationEmail.js'

test('builds an email with an absolute link and escapes names', () => {
  const m = buildNotificationEmail({ type: 'new_follower', actor_id: 'a1' }, { nickname: '<b>Ann' }, 'https://x.app/')
  assert.match(m.subject, /started following you/)
  assert.ok(m.text.includes('https://x.app/riders/a1'))
  assert.ok(!m.html.includes('<b>Ann'))
})

test('sendEmail is a no-op without a provider key and posts with one', async () => {
  assert.equal(await sendEmail({ to: 'a@b.c' }, {}), false)
  let sent
  const ok = await sendEmail({ to: 'a@b.c', subject: 's' }, { RESEND_API_KEY: 'k' }, async (u, o) => ((sent = o), { ok: true }))
  assert.equal(ok, true)
  assert.equal(JSON.parse(sent.body).to[0], 'a@b.c')
})
