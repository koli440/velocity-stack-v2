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
