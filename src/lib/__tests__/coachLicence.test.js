import test from 'node:test'
import assert from 'node:assert/strict'
import { evidencePathFor, licenceChip, licenceErrorMessage, validateEvidenceFile } from '../coachLicence.js'
import { describeNotification, notificationHref } from '../notifications.js'

test('licenceChip: verified is green, self-declared grey, missing hidden', () => {
  assert.equal(licenceChip(null), null)
  assert.deepEqual(licenceChip({ verified: true, body: 'UCI', level: 'Level 2' }), { verified: true, label: 'Verified · UCI Level 2' })
  assert.match(licenceChip({ verified: false, body: 'UCI', level: 'Level 2' }).label, /self-declared/)
})

test('validateEvidenceFile enforces type and 5 MB', () => {
  assert.ok(validateEvidenceFile(null))
  assert.ok(validateEvidenceFile({ type: 'text/html', size: 10 }))
  assert.ok(validateEvidenceFile({ type: 'application/pdf', size: 5 * 1024 * 1024 + 1 }))
  assert.equal(validateEvidenceFile({ type: 'application/pdf', size: 1000 }), null)
})

test('evidencePathFor stays under the user prefix with a sanitised name', () => {
  const p = evidencePathFor('u-1', '../My Licence (1).PDF')
  assert.ok(p.startsWith('u-1/'))
  assert.ok(!p.slice(4).includes('/') && !p.includes('..') && !/[ ()]/.test(p))
})

test('licence notifications and errors', () => {
  assert.match(describeNotification({ type: 'licence_reviewed' }), /licence was reviewed/)
  assert.match(describeNotification({ type: 'licence_expiring' }), /expir/)
  assert.equal(notificationHref({ type: 'licence_reviewed' }), '/settings/coach-card')
  assert.match(describeNotification({ type: 'licence_submitted' }), /waiting for your review/)
  assert.equal(notificationHref({ type: 'licence_submitted' }), '/admin/coach-licences')
  assert.match(licenceErrorMessage({ message: 'Unknown licence level' }), /list/)
})
