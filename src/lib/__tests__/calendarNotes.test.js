import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NOTE_TITLE_MAX,
  NOTE_BODY_MAX,
  validateNote,
  noteAuthorLabel,
  noteEditedLabel,
  noteProfileIds,
  groupNotesByDay,
  fetchNotesInRange,
  createNote,
  updateNote,
  deleteNote,
} from '../calendarNotes.js'
import { buildMonthGrid, buildCalendarRows } from '../calendar.js'

test('validateNote trims and enforces limits', () => {
  assert.deepEqual(validateNote({ title: ' Ill ', body: ' flu ' }).value, { title: 'Ill', body: 'flu' })
  assert.deepEqual(validateNote({ title: 'x' }).value, { title: 'x', body: '' })
  assert.ok(validateNote({ title: '   ' }).error)
  assert.ok(validateNote({}).error)
  assert.ok(validateNote({ title: 'x'.repeat(NOTE_TITLE_MAX + 1) }).error)
  assert.ok(validateNote({ title: 'x', body: 'y'.repeat(NOTE_BODY_MAX + 1) }).error)
  assert.ok(!validateNote({ title: 'x'.repeat(NOTE_TITLE_MAX), body: 'y'.repeat(NOTE_BODY_MAX) }).error)
})

test('author labels: name, You, former coach', () => {
  const coachNote = { created_by: 'c1', updated_by: 'c1', set_by_coach: true }
  assert.equal(noteAuthorLabel(coachNote, { c1: 'Amy' }, 'r1'), 'Amy')
  assert.equal(noteAuthorLabel(coachNote, { c1: 'Amy' }, 'c1'), 'You')
  assert.equal(noteAuthorLabel(coachNote, {}, 'r1'), 'former coach')
  assert.equal(noteAuthorLabel({ ...coachNote, created_by: null }, { c1: 'Amy' }, 'r1'), 'former coach')
  assert.equal(noteAuthorLabel({ created_by: 'r1', set_by_coach: false }, { r1: 'Bob' }, 'c1'), 'Bob')
  assert.equal(noteAuthorLabel({ created_by: 'r1', set_by_coach: false }, {}, 'c1'), 'Rider')
  assert.equal(noteAuthorLabel(null), '')
})

test('edited labels only when someone else edited', () => {
  const base = { created_by: 'r1', updated_by: 'r1', set_by_coach: false }
  assert.equal(noteEditedLabel(base, {}, 'r1'), null)
  assert.equal(noteEditedLabel({ ...base, updated_by: 'c1' }, { c1: 'Amy' }, 'r1'), 'edited by Amy')
  assert.equal(noteEditedLabel({ ...base, updated_by: 'c1' }, {}, 'c1'), 'edited by You')
  assert.equal(noteEditedLabel({ ...base, updated_by: null }, {}, 'r1'), 'edited by former coach')
  assert.equal(noteEditedLabel({ created_by: null, updated_by: null, set_by_coach: true }, {}, 'r1'), null)
})

test('noteProfileIds collects distinct author ids', () => {
  const ids = noteProfileIds([{ created_by: 'a', updated_by: 'b' }, { created_by: 'a', updated_by: null }, { created_by: null }])
  assert.deepEqual(ids.sort(), ['a', 'b'])
})

test('groupNotesByDay buckets by day, oldest first, ignoring bad dates', () => {
  const g = groupNotesByDay([
    { id: '2', note_date: '2026-12-07', created_at: '2026-12-01T10:00:00Z' },
    { id: '1', note_date: '2026-12-07', created_at: '2026-12-01T09:00:00Z' },
    { id: '3', note_date: '2026-12-08', created_at: '2026-12-01T09:00:00Z' },
    { id: '4', note_date: 'nope' },
  ])
  assert.deepEqual(g['2026-12-07'].map((n) => n.id), ['1', '2'])
  assert.equal(Object.keys(g).length, 2)
})

test('notes land on their day cell next to events', () => {
  const rows = buildCalendarRows(buildMonthGrid(new Date(2026, 11, 10)), [], {
    anchor: new Date(2026, 11, 10),
    notes: [{ id: 'n', note_date: '2026-12-09', title: 'Ill', created_at: 'x' }],
  })
  const cells = rows.flatMap((r) => r.cells)
  assert.equal(cells.filter((c) => c.notes.length).length, 1)
  assert.equal(cells.find((c) => c.key === '2026-12-09').notes[0].title, 'Ill')
  assert.equal(rows.every((r) => r.summary.count === 0), true)
})

function fakeClient(result) {
  const calls = []
  const q = {
    select() { calls.push(['select']); return q },
    insert(v) { calls.push(['insert', v]); return q },
    update(v) { calls.push(['update', v]); return q },
    delete() { calls.push(['delete']); return q },
    eq(c, v) { calls.push(['eq', c, v]); return q },
    gte(c, v) { calls.push(['gte', c, v]); return q },
    lte(c, v) { calls.push(['lte', c, v]); return q },
    order() { return q },
    single: async () => result,
    maybeSingle: async () => result,
    then: (res) => res(result),
  }
  return { from: (t) => { calls.push(['from', t]); return q }, calls }
}

test('fetchNotesInRange queries only the visible range of one rider', async () => {
  const c = fakeClient({ data: [{ id: 1 }], error: null })
  const r = await fetchNotesInRange(c, { riderId: 'r', startDay: '2026-11-30', endDay: '2027-01-03' })
  assert.deepEqual(r.data, [{ id: 1 }])
  assert.ok(c.calls.some((x) => x[0] === 'from' && x[1] === 'calendar_notes'))
  assert.ok(c.calls.some((x) => x[0] === 'gte' && x[2] === '2026-11-30'))
  assert.ok(c.calls.some((x) => x[0] === 'lte' && x[2] === '2027-01-03'))
  assert.deepEqual(await fetchNotesInRange(c, { riderId: null, startDay: '2026-11-30', endDay: '2027-01-03' }), { data: [], error: null })
})

test('createNote sends only writable columns (never author stamps)', async () => {
  const c = fakeClient({ data: { id: 1 }, error: null })
  await createNote(c, { riderId: 'r', day: '2026-12-07', title: ' Ill ', body: '', created_by: 'evil', set_by_coach: true })
  const ins = c.calls.find((x) => x[0] === 'insert')[1]
  assert.deepEqual(ins, { rider_id: 'r', note_date: '2026-12-07', title: 'Ill', body: '' })
  assert.ok((await createNote(c, { riderId: 'r', day: 'bad', title: 'x' })).error)
  assert.ok((await createNote(c, { riderId: 'r', day: '2026-12-07', title: '' })).error)
})

test('updateNote / deleteNote report rows that are not writable', async () => {
  const gone = fakeClient({ data: null, error: null })
  assert.ok((await updateNote(gone, 'id', { day: '2026-12-07', title: 'x' })).error)
  const none = fakeClient({ data: [], error: null })
  assert.ok((await deleteNote(none, 'id')).error)
  const ok = fakeClient({ data: [{ id: 'id' }], error: null })
  assert.equal((await deleteNote(ok, 'id')).error, null)
  const upd = fakeClient({ data: { id: 'id' }, error: null })
  await updateNote(upd, 'id', { day: '2026-12-08', title: 'x', body: 'b' })
  assert.deepEqual(upd.calls.find((x) => x[0] === 'update')[1], { note_date: '2026-12-08', title: 'x', body: 'b' })
})
