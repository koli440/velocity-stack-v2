import test from 'node:test'
import assert from 'node:assert/strict'
import * as n from '../coachNotes.js'

test('validateNote mirrors the SQL limits', () => {
  assert.equal(n.validateNote({ body: ' ' }), 'Write something first.')
  assert.ok(n.validateNote({ body: 'x'.repeat(4001) }))
  assert.ok(n.validateNote({ body: 'x', title: 'y'.repeat(81) }))
  assert.ok(n.validateNote({ body: 'x', tags: ['nope'] }))
  assert.equal(n.validateNote({ body: 'ok', title: 't', tags: ['injury', 'goal'] }), null)
})

test('filterNotes filters by tag/query and keeps pinned first', () => {
  const notes = [
    { id: 1, note_date: '2026-11-01', title: 'a', body: 'knee', tags: ['injury'], pinned: false },
    { id: 2, note_date: '2026-11-03', title: 'b', body: 'plan', tags: ['goal'], pinned: false },
    { id: 3, note_date: '2026-10-01', title: 'c', body: 'old', tags: [], pinned: true },
  ]
  assert.deepEqual(n.filterNotes(notes).map((x) => x.id), [3, 2, 1])
  assert.deepEqual(n.filterNotes(notes, { tag: 'injury' }).map((x) => x.id), [1])
  assert.deepEqual(n.filterNotes(notes, { query: 'PLAN' }).map((x) => x.id), [2])
})

test('notesToText and exportDaysLeft', () => {
  const t = n.notesToText([{ note_date: '2026-11-01', title: 'Knee', body: 'sore', tags: ['injury'], shared_with_rider: true }], 'Ann')
  assert.match(t, /^Coach notes: Ann/)
  assert.match(t, /2026-11-01 Knee \[injury\] \(shared with athlete\)\nsore/)
  assert.equal(n.exportDaysLeft('2026-11-10T00:00:00Z', new Date('2026-11-08T12:00:00Z')), 2)
  assert.equal(n.exportDaysLeft('2026-11-01T00:00:00Z', new Date('2026-11-08T12:00:00Z')), 0)
})

test('error messages are friendly', () => {
  assert.match(n.coachNoteErrorMessage({ message: 'Coach module is not enabled' }), /not available/)
  assert.equal(n.coachNoteErrorMessage({ message: 'boom' }), 'Something went wrong. Please try again.')
})
