import test from 'node:test'
import assert from 'node:assert/strict'
import { selectableRaces, raceOptionLabel, attentionMessage, canAcknowledge, addRaceToCalendarHref } from '../macroPlannerCalendar.js'

const races = [
  { id: 'a', name: 'Zed', race_date: '2027-05-01' },
  { id: 'b', name: 'Past', race_date: '2026-01-01' },
  { id: 'c', name: 'Alpha', race_date: '2027-05-01', format_note: '160 km', location: 'Ghent' },
  { id: 'd', name: 'Late', race_date: '2027-09-01' },
  { name: 'No id', race_date: '2027-06-01' },
]

test('selectableRaces: upcoming only, sorted, excludes used and later races', () => {
  assert.deepEqual(selectableRaces(races, { today: '2026-11-20' }).map((r) => r.id), ['c', 'a', 'd'])
  assert.deepEqual(selectableRaces(races, { today: '2026-11-20', usedIds: ['c'], before: '2027-09-01' }).map((r) => r.id), ['a'])
  assert.deepEqual(selectableRaces(null, { today: '2026-11-20' }), [])
})

test('raceOptionLabel shows calendar name, date and context', () => {
  assert.equal(raceOptionLabel(races[2]), '2027-05-01 · Alpha (160 km, Ghent)')
  assert.equal(raceOptionLabel(races[0]), '2027-05-01 · Zed')
})

test('attention messages and acknowledge rule', () => {
  for (const k of ['race_unlinked', 'race_deleted', 'race_moved', 'minor_race_deleted']) assert.ok(attentionMessage(k))
  assert.equal(attentionMessage(null), null)
  assert.equal(canAcknowledge('race_moved'), true)
  assert.equal(canAcknowledge('race_deleted'), false)
  assert.equal(addRaceToCalendarHref('r1'), '/coach/r1/calendar')
})
