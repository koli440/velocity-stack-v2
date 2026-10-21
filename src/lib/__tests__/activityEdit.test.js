// Run with: node --test src/lib/__tests__/activityEdit.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildActivityUpdates, updateActivity } from '../activityEdit.js'

const base = { title: ' Morning ', trackId: 't1', visibility: 'followers', chainring: '52', cog: '14', description: '  nice  ' }

test('builds a trimmed update payload', () => {
  const { updates, error } = buildActivityUpdates(base)
  assert.equal(error, null)
  assert.deepEqual(updates, {
    title: 'Morning', track_id: 't1', visibility: 'followers', chainring: 52, cog: 14, description: 'nice',
  })
})

test('optional fields become null', () => {
  const { updates } = buildActivityUpdates({ ...base, trackId: '', chainring: '', cog: '', description: '   ' })
  assert.equal(updates.track_id, null)
  assert.equal(updates.chainring, null)
  assert.equal(updates.cog, null)
  assert.equal(updates.description, null)
})

test('rejects empty title, invalid visibility and over-long text', () => {
  assert.ok(buildActivityUpdates({ ...base, title: '  ' }).error)
  assert.ok(buildActivityUpdates({ ...base, visibility: 'everyone' }).error)
  assert.ok(buildActivityUpdates({ ...base, title: 'x'.repeat(121) }).error)
  assert.ok(buildActivityUpdates({ ...base, description: 'x'.repeat(2001) }).error)
})

test('gear is optional but must be a valid pair', () => {
  assert.ok(buildActivityUpdates({ ...base, chainring: '52', cog: '' }).error)
  assert.ok(buildActivityUpdates({ ...base, chainring: '5', cog: '14' }).error)
  assert.equal(buildActivityUpdates({ ...base, chainring: 50, cog: 15 }).updates.chainring, 50)
})

test('updateActivity writes the payload for the activity id', async () => {
  let seen
  const client = {
    from: (t) => ({
      update: (u) => ({ eq: async (c, v) => { seen = { t, u, c, v }; return { error: null } } }),
    }),
  }
  const { error } = await updateActivity(client, 'a1', base)
  assert.equal(error, null)
  assert.equal(seen.t, 'activities')
  assert.equal(seen.c, 'id')
  assert.equal(seen.v, 'a1')
  assert.equal(seen.u.title, 'Morning')
  const bad = await updateActivity(client, 'a1', { ...base, title: '' })
  assert.ok(bad.error)
})

test('ride type: road keeps stored gear untouched (no gear keys in the payload)', () => {
  const { updates, error } = buildActivityUpdates({ ...base, rideType: 'road', chainring: '', cog: '' })
  assert.equal(error, null)
  assert.equal(updates.ride_type, 'road')
  for (const k of ['gears', 'gear_segments', 'chainring', 'cog']) assert.equal(k in updates, false)
})

test('ride type: unknown type is rejected', () => {
  assert.ok(buildActivityUpdates({ ...base, rideType: 'hovercraft' }).error)
})

test('track: gear list + segments become the payload and primary mirrors chainring/cog', () => {
  const gears = [{ id: 'g1', chainring: '58', cog: '14', note: 'race' }, { id: 'g2', chainring: '52', cog: '15', note: '' }]
  const gearSegments = [{ start_s: 0, end_s: 60, gear_id: 'g2' }]
  const { updates, error } = buildActivityUpdates({ ...base, rideType: 'track', gears, gearSegments })
  assert.equal(error, null)
  assert.equal(updates.ride_type, 'track')
  assert.equal(updates.gears.length, 2)
  assert.deepEqual(updates.gear_segments, gearSegments)
  assert.equal(updates.chainring, 58)
  assert.equal(updates.cog, 14)
})

test('track: invalid gear list or segment is rejected; empty list clears gear', () => {
  assert.ok(buildActivityUpdates({ ...base, rideType: 'track', gears: [{ id: 'g1', chainring: '58', cog: '' }] }).error)
  const g = [{ id: 'g1', chainring: '58', cog: '14' }]
  assert.ok(buildActivityUpdates({ ...base, rideType: 'track', gears: g, gearSegments: [{ start_s: 0, end_s: 5, gear_id: 'zz' }] }).error)
  const { updates } = buildActivityUpdates({ ...base, rideType: 'track', gears: [] })
  assert.deepEqual([updates.gears, updates.gear_segments, updates.chainring, updates.cog], [[], [], null, null])
})

test('keepGear leaves gear columns out without changing the ride type', () => {
  const { updates } = buildActivityUpdates({ ...base, keepGear: true })
  for (const k of ['ride_type', 'gears', 'gear_segments', 'chainring', 'cog']) assert.equal(k in updates, false)
})
