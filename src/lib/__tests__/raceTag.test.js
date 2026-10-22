import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saveActivityRace, raceTagOrigin } from '../raceTag.js'

const client = (rpc, row) => ({
  rpc: async (name, args) => rpc(name, args),
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
})

test('saveActivityRace calls the audited RPC and reloads the tag columns', async () => {
  let call
  const row = { is_race: true, race_tag_auto: false, race_set_by_coach: true }
  const { fresh, error } = await saveActivityRace(client((n, a) => { call = [n, a]; return { data: true, error: null } }, row), 'a1', true)
  assert.deepEqual(call, ['set_activity_race', { p_activity: 'a1', p_is_race: true }])
  assert.equal(error, null)
  assert.deepEqual(fresh, row)
})

test('saveActivityRace falls back to the RPC result and surfaces errors', async () => {
  const ok = await saveActivityRace(client(() => ({ data: true, error: null }), null), 'a1', true)
  assert.deepEqual(ok.fresh, { is_race: true, race_tag_auto: false })
  const bad = await saveActivityRace(client(() => ({ data: null, error: new Error('Activity not found') }), null), 'a1', true)
  assert.equal(bad.fresh, null)
  assert.equal(bad.error.message, 'Activity not found')
  assert.equal(raceTagOrigin({ is_race: false }), '')
})
