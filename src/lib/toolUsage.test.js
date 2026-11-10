import test from 'node:test'
import assert from 'node:assert/strict'
import { toolEventParams, trackToolEvent, resetToolEventsForTests } from './toolUsage.js'

test('params are normalised and never carry identifiers', () => {
  assert.deepEqual(toolEventParams('pursuit', 'plan', { discipline: ' Team Pursuit ', distanceM: 4000.4, myPacing: true }), {
    p_tool: 'pursuit', p_event: 'plan', p_discipline: 'Team Pursuit', p_distance_m: 4000, p_my_pacing: true, p_reason: null,
  })
  const p = toolEventParams('gear', 'view')
  assert.deepEqual(Object.keys(p).sort(), ['p_discipline', 'p_distance_m', 'p_event', 'p_my_pacing', 'p_reason', 'p_tool'])
  assert.equal(p.p_discipline, null)
  assert.equal(toolEventParams('pursuit', 'plan', { discipline: 'x'.repeat(80), distanceM: -5 }).p_discipline.length, 40)
  assert.equal(toolEventParams('pursuit', 'plan', { distanceM: -5 }).p_distance_m, null)
})

test('each distinct event is sent once and errors are swallowed', async () => {
  resetToolEventsForTests()
  const calls = []
  const client = { rpc: (name, params) => { calls.push([name, params]); return Promise.reject(new Error('x')) } }
  assert.equal(trackToolEvent(client, 'gear', 'view'), true)
  assert.equal(trackToolEvent(client, 'gear', 'view'), false)
  assert.equal(trackToolEvent(client, 'gear', 'calculate'), true)
  assert.equal(trackToolEvent(null, 'gear', 'compare'), false)
  assert.equal(trackToolEvent({ rpc: () => { throw new Error('boom') } }, 'pursuit', 'view'), true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0][0], 'track_tool_event')
})
