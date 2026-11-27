import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { handlePost, handleMessage, negotiateVersion, countToolCalls, LATEST_PROTOCOL_VERSION } from '../mcp/protocol.js'
import { TOOLS, listTools, callTool, toolErrorMessage, structureArg, rangeArgs, dayArg, plannedView, plannedViews, raceView, noteView, raceFields, noteFields } from '../mcp/tools.js'
import { plannedToEvent } from '../plannedWorkouts.js'
import { protectedResourceMetadata, authorizationServerMetadata, wwwAuthenticate, MCP_SCOPES } from '../mcp/discovery.js'
import { computeSplits, templateRunView, activitySummaryView, fitnessView, nextDay, safeLike, MAX_SPLITS } from '../mcp/views.js'
import { PARTNER_SCOPES, SCOPE_LABELS } from '../partnerScopes.js'
import { validateRegistration } from '../partnerApps.js'

const ALL = ['profile:read', 'plans:read', 'plans:write', 'activities:read']
const ID = '11111111-2222-4333-8444-555555555555'

function fakeData(over = {}) {
  const calls = []
  const rec = (name) => async (...args) => {
    // The planned-load context is a read helper: not recorded (and null) unless a test provides it.
    if (name === 'loadContext' && !over.loadContext) return null
    calls.push([name, ...args])
    return over[name] ? over[name](...args) : { id: ID, rider_id: ID, workout_date: '2026-12-01', discipline: 'ride', title: 'T', description: '', status: 'planned' }
  }
  const data = new Proxy({}, { get: (_, k) => rec(k) })
  return { data, calls }
}
const parse = (r) => JSON.parse(r.content[0].text)

// ---- Protocol -----------------------------------------------------------------------------------

test('initialize negotiates the protocol version and advertises tools', async () => {
  const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, {})
  assert.equal(r.result.protocolVersion, '2025-06-18')
  assert.ok(r.result.capabilities.tools)
  assert.equal(r.result.serverInfo.name, 'velocity-stack')
  assert.equal(negotiateVersion('1999-01-01'), LATEST_PROTOCOL_VERSION)
})

test('notifications get 202 without body; unknown methods and bad requests are JSON-RPC errors', async () => {
  assert.deepEqual(await handlePost({ jsonrpc: '2.0', method: 'notifications/initialized' }, {}), { status: 202, body: null })
  const r = await handlePost({ jsonrpc: '2.0', id: 7, method: 'resources/list' }, {})
  assert.equal(r.body.error.code, -32601)
  assert.equal((await handlePost({ foo: 1 }, {})).body.error.code, -32600)
  assert.equal((await handlePost([], {})).status, 400)
  const missing = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {} }, {})
  assert.equal(missing.error.code, -32602)
})

test('batches answer every request and count tool calls', async () => {
  const server = { listTools: async () => [], callTool: async () => ({ content: [] }) }
  const payload = [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'x' } }]
  const r = await handlePost(payload, server)
  assert.equal(r.body.length, 2)
  assert.equal(countToolCalls(payload), 1)
})

test('a server exception becomes an internal error without details', async () => {
  const r = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { listTools: async () => { throw new Error('secret db detail') } })
  assert.equal(r.error.code, -32603)
  assert.ok(!JSON.stringify(r).includes('secret'))
})

// ---- Scopes -----------------------------------------------------------------------------------

test('new scopes are registered with consent labels and accepted at registration', () => {
  for (const s of ['plans:read', 'plans:write', 'activities:read']) {
    assert.ok(PARTNER_SCOPES.includes(s))
    assert.ok(SCOPE_LABELS[s]?.length > 10)
  }
  const reg = validateRegistration({ name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], scopes: MCP_SCOPES })
  assert.deepEqual(reg.scopes, [...MCP_SCOPES])
})

test('every tool has a known scope and an object input schema', () => {
  for (const [name, t] of Object.entries(TOOLS)) {
    assert.ok(MCP_SCOPES.includes(t.scope), name)
    assert.equal(t.inputSchema.type, 'object', name)
    assert.equal(t.inputSchema.additionalProperties, false, name)
  }
})

test('tools/list only shows tools the token has scopes for', () => {
  const names = (scopes, caps) => listTools(scopes, caps).map((t) => t.name)
  assert.deepEqual(names(['activities:write']), [])
  assert.deepEqual(names(['plans:read']), ['list_planned_workouts', 'list_races', 'list_notes'])
  for (const n of ['create_race', 'update_race', 'delete_race', 'create_note', 'update_note', 'delete_note']) {
    assert.ok(names(['plans:write']).includes(n), n)
    assert.ok(!names(['plans:read']).includes(n), n)
  }
  assert.ok(names(ALL).includes('create_planned_workout'))
  assert.ok(!names(['plans:read', 'activities:read']).includes('create_planned_workout'))
  // The macro plan tool only when the planner is available.
  assert.ok(!names(ALL, { macro_planner: false }).includes('get_macro_plan'))
  assert.ok(names(ALL, { macro_planner: true }).includes('get_macro_plan'))
  assert.ok(names(ALL, { has_macro_plan: true }).includes('get_macro_plan'))
})

test('calling a tool without its scope is refused before any data access', async () => {
  const { data, calls } = fakeData()
  const r = await callTool('create_planned_workout', { date: '2026-12-01', discipline: 'ride', title: 'x' }, { scopes: ['plans:read'], data })
  assert.equal(r.isError, true)
  assert.match(r.content[0].text, /plans:write/)
  assert.equal(calls.length, 0)
  assert.deepEqual(await callTool('nope', {}, { scopes: ALL, data }), { unknownTool: true })
  assert.deepEqual(await callTool('toString', {}, { scopes: ALL, data }), { unknownTool: true })
})

// ---- Input validation -----------------------------------------------------------------------------

test('dates and ranges are validated', () => {
  assert.equal(dayArg('2026-12-01', 'd'), '2026-12-01')
  assert.throws(() => dayArg('2026-02-30', 'd'), /valid date/)
  assert.throws(() => dayArg('01.12.2026', 'd'), /YYYY-MM-DD/)
  assert.throws(() => dayArg('1999-12-31', 'd'), /out of range/)
  assert.throws(() => rangeArgs({ from: '2026-12-02', to: '2026-12-01' }, 30), /before/)
  assert.throws(() => rangeArgs({ from: '2026-01-01', to: '2027-06-01' }, 366), /366/)
  assert.deepEqual(rangeArgs({ from: '2026-01-01', to: '2026-12-31' }, 366), { from: '2026-01-01', to: '2026-12-31' })
})

test('structure DSL is parsed with the template parser; blank clears it', () => {
  const st = structureArg('warmup 15min\n4x\nwork 4min @ 105-120%FTP\nrecovery 4min @ <55%FTP\ncooldown 10min')
  assert.ok(st.dsl.includes('4x'))
  assert.equal(st.manifest.steps.length, 8)
  assert.equal(st.manifest.warmup_sec, 900)
  assert.deepEqual(structureArg('  '), { dsl: null, manifest: null })
  assert.equal(structureArg(undefined), undefined)
  assert.throws(() => structureArg('4x\nwork banana'), /structure/)
  assert.throws(() => structureArg(42), /string/)
  assert.throws(() => structureArg('x'.repeat(4001)), /4000/)
})

test('create_planned_workout validates input and passes the parsed snapshot', async () => {
  const { data, calls } = fakeData()
  const bad = async (args, re) => {
    const r = await callTool('create_planned_workout', args, { scopes: ALL, data })
    assert.equal(r.isError, true, JSON.stringify(args))
    assert.match(r.content[0].text, re)
  }
  await bad({ date: '2026-12-01', discipline: 'ride' }, /title/)
  await bad({ date: '2026-12-01', discipline: 'swim', title: 'x' }, /discipline/i)
  await bad({ date: '2026-12-01', discipline: 'ride', title: 'x'.repeat(81) }, /80/)
  await bad({ date: '2026-12-01', discipline: 'ride', title: 'x', description: 'y'.repeat(2001) }, /2000/)
  await bad({ date: 'tomorrow', discipline: 'ride', title: 'x' }, /date/)
  await bad({ date: '2026-12-01', discipline: 'ride', title: 'x', athlete_id: 'bob' }, /UUID/)
  await bad({ date: '2026-12-01', discipline: 'ride', title: 'x', rider_id: ID }, /Unknown argument/)
  assert.equal(calls.length, 0)

  const ok = await callTool('create_planned_workout', { date: '2026-12-01', discipline: 'ride', title: '  Sweet spot ', structure: '3x\nwork 10min @ 88-94%FTP\nrecovery 5min @ <55%FTP', athlete_id: ID.toUpperCase() }, { scopes: ALL, data })
  assert.ok(!ok.isError)
  const [, arg] = calls[0]
  assert.equal(calls[0][0], 'createPlanned')
  assert.equal(arg.title, 'Sweet spot')
  assert.equal(arg.riderId, ID)
  assert.ok(arg.dsl.startsWith('3x'))
  assert.equal(arg.manifest.repeat_count, 3)
  assert.equal(parse(ok).workout.id, ID)
})

test('update / move / skip / delete map to the right data calls', async () => {
  const { data, calls } = fakeData()
  const ctx = { scopes: ALL, data, onWrite: async (n) => calls.push(['audit', n]) }
  await callTool('update_planned_workout', { id: ID, title: 'New', structure: '' }, ctx)
  assert.deepEqual(calls.slice(0, 3), [['updatePlanned', ID, { title: 'New' }], ['setStructure', ID, { dsl: null, manifest: null }], ['audit', 'update_planned_workout']])
  calls.length = 0
  const empty = await callTool('update_planned_workout', { id: ID }, ctx)
  assert.match(empty.content[0].text, /Nothing to update/)
  await callTool('update_planned_workout', { id: ID, title: '   ' }, ctx).then((r) => assert.equal(r.isError, true))
  await callTool('move_planned_workout', { id: ID, date: '2026-12-05' }, ctx)
  await callTool('skip_planned_workout', { id: ID }, ctx)
  await callTool('skip_planned_workout', { id: ID, skipped: false }, ctx)
  await callTool('delete_planned_workout', { id: ID }, ctx)
  assert.deepEqual(calls.filter((c) => c[0] !== 'audit'), [
    ['updatePlanned', ID, { workout_date: '2026-12-05' }],
    ['updatePlanned', ID, { status: 'skipped' }],
    ['updatePlanned', ID, { status: 'planned' }],
    ['deletePlanned', ID],
  ])
  const skipBad = await callTool('skip_planned_workout', { id: ID, skipped: 'yes' }, ctx)
  assert.equal(skipBad.isError, true)
})

test('read tools validate limits and do not audit', async () => {
  const { data, calls } = fakeData({ listActivities: async () => [], getFitness: async () => ({ fitness: 1 }) })
  const ctx = { scopes: ALL, data, onWrite: async (n) => calls.push(['audit', n]) }
  assert.equal((await callTool('list_activities', { from: '2026-11-01', to: '2026-11-30', limit: 500 }, ctx)).isError, true)
  await callTool('list_activities', { from: '2026-11-01', to: '2026-11-30' }, ctx)
  assert.deepEqual(calls.at(-1), ['listActivities', { from: '2026-11-01', to: '2026-11-30', limit: 50 }])
  assert.equal((await callTool('get_fitness', { days: 3 }, ctx)).isError, true)
  await callTool('get_fitness', {}, ctx)
  assert.deepEqual(calls.at(-1), ['getFitness', { days: 42 }])
  assert.equal((await callTool('get_activity', { id: 'x' }, ctx)).isError, true)
  assert.ok(!calls.some((c) => c[0] === 'audit'))
})

test('database errors are mapped to safe messages', () => {
  assert.equal(toolErrorMessage(new Error('Planned workout not found')), 'Planned workout not found')
  assert.equal(toolErrorMessage(new Error('Too many planned workouts on this day')), 'Too many planned workouts on this day')
  assert.match(toolErrorMessage(new Error('insufficient_scope')), /permission/)
  assert.match(toolErrorMessage(new Error('relation "x" does not exist at character 12')), /went wrong/)
})

test('planned workout view derives status and structure summary', () => {
  const w = { id: ID, rider_id: ID, workout_date: '2026-11-01', discipline: 'ride', title: 'A', status: 'planned', activity_id: null, structure_dsl: '1x\nwork 1h @ 90%FTP', structure_manifest: structureArg('1x\nwork 1h @ 90%FTP').manifest }
  const v = plannedView(w, new Date('2026-11-27T12:00:00Z'))
  assert.equal(v.status, 'missed')
  assert.equal(v.estimated_duration_s, 3600)
  assert.equal(v.estimated_load, 81)
  assert.equal(plannedView({ ...w, activity_id: ID }).status, 'completed')
})

// ---- Planned load = the calendar's "~TL" (bug: MCP returned 8 / null) ---------------------------

const FTP285 = { ftpHistory: [{ effective_from: '2026-01-01', ftp_w: 285 }], ltHistory: [], zoneHistory: [] }
const plannedRow = (dsl, over = {}) => ({
  id: ID, rider_id: ID, workout_date: '2026-12-01', discipline: 'ride', title: 'T', status: 'planned', activity_id: null,
  structure_dsl: dsl, structure_manifest: structureArg(dsl).manifest, ...over,
})
const TODAY = new Date('2026-11-27T12:00:00Z')

test('estimated_load equals the calendar TL for watt bands (3x15min @ 255-270W, FTP 285 -> 71)', () => {
  const w = plannedRow('warmup 15min\n3x\nwork 15min @ 255-270W\nrecovery 5min @ <55%FTP\ncooldown 10min')
  const v = plannedView(w, TODAY, FTP285)
  assert.equal(v.estimated_duration_s, 85 * 60)
  assert.equal(v.estimated_load, 71)
  assert.equal(v.estimated_load, plannedToEvent(w, TODAY, FTP285).load)
  // Without the rider's thresholds only the %FTP recovery counted: that was the wrong 8.
  assert.equal(plannedView(w, TODAY).estimated_load, 8)
})

test('estimated_load of a single watt step (work 120min @ 185-225W, FTP 285) is the calendar TL, not null', () => {
  const w = plannedRow('work 120min @ 185-225W')
  const v = plannedView(w, TODAY, FTP285)
  assert.equal(v.estimated_duration_s, 7200)
  assert.equal(v.estimated_load, 103)
  assert.equal(v.estimated_load, plannedToEvent(w, TODAY, FTP285).load)
  assert.equal(plannedView(w, TODAY).estimated_load, null)
  assert.equal(plannedView({ ...w, discipline: 'run' }, TODAY, FTP285).estimated_load, null)
})

test('every planned-workout tool loads the rider\'s load context once and returns the calendar TL', async () => {
  const dsl = 'warmup 15min\n3x\nwork 15min @ 255-270W\nrecovery 5min @ <55%FTP\ncooldown 10min'
  const row = plannedRow(dsl)
  const { data, calls } = fakeData({
    loadContext: async () => FTP285,
    listPlanned: async () => [row, { ...row, id: '11111111-2222-4333-8444-666666666666' }],
    createPlanned: async () => row, updatePlanned: async () => row, setStructure: async () => row,
  })
  const ctx = { scopes: ALL, data }
  const list = parse(await callTool('list_planned_workouts', { from: '2026-12-01', to: '2026-12-07' }, ctx))
  assert.deepEqual(list.workouts.map((w) => w.estimated_load), [71, 71])
  assert.equal(calls.filter((c) => c[0] === 'loadContext').length, 1)
  assert.deepEqual(calls.find((c) => c[0] === 'loadContext'), ['loadContext', ID])
  for (const [tool, args] of [
    ['create_planned_workout', { date: '2026-12-01', discipline: 'ride', title: 'x', structure: dsl }],
    ['update_planned_workout', { id: ID, structure: dsl }],
    ['move_planned_workout', { id: ID, date: '2026-12-02' }],
    ['skip_planned_workout', { id: ID, skipped: false }],
  ]) {
    const r = await callTool(tool, args, ctx)
    assert.equal(parse(r).workout.estimated_load, 71, tool)
  }
  // A failing context load falls back like the calendar does (no error).
  const broken = fakeData({ loadContext: async () => { throw new Error('db down') }, listPlanned: async () => [row] })
  const r = parse(await callTool('list_planned_workouts', { from: '2026-12-01', to: '2026-12-07' }, { scopes: ALL, data: broken.data }))
  assert.equal(r.workouts[0].estimated_load, 8)
  assert.deepEqual(await plannedViews([], { data: broken.data }), [])
})

// ---- Races and notes ----------------------------------------------------------------------------

const RACE = { id: ID, rider_id: ID, race_date: '2027-05-10', race_time: '09:30:00', name: 'Gran Fondo', discipline: 'ride', priority: 'A', location: 'Prague', format_note: '', notes: 'Goal', activity_id: null, set_by_coach: true }
const NOTE = { id: ID, rider_id: ID, note_date: '2026-12-03', title: 'Ill', body: 'Fever, no training', set_by_coach: false, updated_at: '2026-11-27T10:00:00Z' }

test('race tools validate with the app rules and map to the data calls', async () => {
  const { data, calls } = fakeData({ listRaces: async () => [RACE], createRace: async () => RACE, updateRace: async () => RACE })
  const ctx = { scopes: ALL, data, onWrite: async (n) => calls.push(['audit', n]) }
  const list = parse(await callTool('list_races', { from: '2027-01-01', to: '2027-12-31', athlete_id: ID }, ctx))
  assert.deepEqual(list.races[0], raceView(RACE))
  assert.equal(list.races[0].time, '09:30')
  assert.equal(list.races[0].added_by_coach, true)
  assert.deepEqual(calls.at(-1), ['listRaces', { riderId: ID, from: '2027-01-01', to: '2027-12-31' }])

  const bad = async (tool, args, re) => {
    const n = calls.length
    const r = await callTool(tool, args, ctx)
    assert.equal(r.isError, true, JSON.stringify(args))
    assert.match(r.content[0].text, re)
    assert.equal(calls.length, n)
  }
  await bad('create_race', { date: '2027-05-10' }, /name/)
  await bad('create_race', { date: '2027-05-10', name: 'x', priority: 'D' }, /priority/)
  await bad('create_race', { date: '2027-05-10', name: 'x', discipline: 'run' }, /discipline/)
  await bad('create_race', { date: '2027-05-10', name: 'x'.repeat(81) }, /80/)
  await bad('create_race', { date: '2027-05-10', name: 'x', location: 'y'.repeat(121) }, /120/)
  await bad('create_race', { date: '2027-05-10', name: 'x', notes: 'y'.repeat(1001) }, /1000/)
  await bad('create_race', { date: 'May', name: 'x' }, /date/)
  await bad('update_race', { id: ID }, /Nothing to update/)
  await bad('update_race', { id: ID, name: '  ' }, /name/)
  await bad('delete_race', { id: 'nope' }, /UUID/)

  await callTool('create_race', { date: '2027-05-10', name: ' Gran Fondo ', priority: 'a', location: ' Prague ' }, ctx)
  assert.deepEqual(calls.at(-2), ['createRace', { riderId: null, date: '2027-05-10', fields: { discipline: 'ride', priority: 'A', name: 'Gran Fondo', location: 'Prague' } }])
  assert.deepEqual(calls.at(-1), ['audit', 'create_race'])
  await callTool('update_race', { id: ID, date: '2027-05-11', priority: 'B' }, ctx)
  assert.deepEqual(calls.at(-2), ['updateRace', ID, { priority: 'B', race_date: '2027-05-11' }])
  await callTool('delete_race', { id: ID }, ctx)
  assert.deepEqual(calls.at(-2), ['deleteRace', ID])
  assert.deepEqual(raceFields({ notes: '  ' }), { notes: '' })
})

test('note tools: title from the first line, app limits, partial updates', async () => {
  const { data, calls } = fakeData({ listNotes: async () => [NOTE], createNote: async () => NOTE, updateNote: async () => NOTE })
  const ctx = { scopes: ALL, data, onWrite: async (n) => calls.push(['audit', n]) }
  const list = parse(await callTool('list_notes', { from: '2026-12-01', to: '2026-12-31' }, ctx))
  assert.deepEqual(list.notes, [noteView(NOTE)])
  assert.equal(list.notes[0].text, 'Fever, no training')

  await callTool('create_note', { date: '2026-12-03', text: '  Travel to Mallorca  ' }, ctx)
  assert.deepEqual(calls.at(-2), ['createNote', { riderId: null, date: '2026-12-03', fields: { body: '', title: 'Travel to Mallorca' } }])
  await callTool('create_note', { date: '2026-12-03', text: 'Ill\nFever since Monday', athlete_id: ID }, ctx)
  assert.deepEqual(calls.at(-2), ['createNote', { riderId: ID, date: '2026-12-03', fields: { title: 'Ill', body: 'Ill\nFever since Monday' } }])
  await callTool('create_note', { date: '2026-12-03', title: 'Camp', text: 'Altitude camp week' }, ctx)
  assert.deepEqual(calls.at(-2)[1].fields, { title: 'Camp', body: 'Altitude camp week' })
  const long = noteFields({ text: 'x'.repeat(200) }, { create: true })
  assert.equal(long.title.length, 80)
  assert.equal(long.body.length, 200)

  const bad = async (tool, args, re) => {
    const n = calls.length
    const r = await callTool(tool, args, ctx)
    assert.equal(r.isError, true, JSON.stringify(args))
    assert.match(r.content[0].text, re)
    assert.equal(calls.length, n)
  }
  await bad('create_note', { date: '2026-12-03' }, /text/)
  await bad('create_note', { date: '2026-12-03', text: '   ' }, /text|title/)
  await bad('create_note', { date: '2026-12-03', text: 'y'.repeat(1001) }, /1000/)
  await bad('create_note', { date: '2026-12-03', text: 'a', title: 'x'.repeat(81) }, /80/)
  await bad('create_note', { date: '2026-12-03', text: 'a', body: 'b' }, /Unknown argument/)
  await bad('update_note', { id: ID }, /Nothing to update/)

  await callTool('update_note', { id: ID, text: 'Better now' }, ctx)
  assert.deepEqual(calls.at(-2), ['updateNote', ID, { body: 'Better now' }])
  await callTool('update_note', { id: ID, date: '2026-12-04', title: 'Sick' }, ctx)
  assert.deepEqual(calls.at(-2), ['updateNote', ID, { title: 'Sick', note_date: '2026-12-04' }])
  await callTool('delete_note', { id: ID }, ctx)
  assert.deepEqual(calls.at(-2), ['deleteNote', ID])
})

test('race / note database errors are mapped to their messages', () => {
  for (const m of ['Race not found', 'Too many races on this day', 'Invalid race values', 'Note not found', 'Too many notes on this day', 'Invalid note values']) {
    assert.equal(toolErrorMessage(new Error(m)), m)
  }
})

// ---- Discovery ----------------------------------------------------------------------------------

test('discovery documents point at the existing OAuth provider', () => {
  const prm = protectedResourceMetadata('https://www.velocity-stack.app/')
  assert.equal(prm.resource, 'https://www.velocity-stack.app/api/mcp')
  assert.deepEqual(prm.authorization_servers, ['https://www.velocity-stack.app'])
  assert.deepEqual(prm.scopes_supported, MCP_SCOPES)
  const as = authorizationServerMetadata('https://www.velocity-stack.app')
  assert.equal(as.issuer, 'https://www.velocity-stack.app')
  assert.equal(as.authorization_endpoint, 'https://www.velocity-stack.app/oauth/authorize')
  assert.equal(as.token_endpoint, 'https://www.velocity-stack.app/api/oauth/token')
  assert.deepEqual(as.code_challenge_methods_supported, ['S256'])
  assert.ok(!as.scopes_supported.includes('offline_access'))
  for (const s of MCP_SCOPES) assert.ok(as.scopes_supported.includes(s))
  const h = wwwAuthenticate('https://www.velocity-stack.app', { error: 'invalid_token', description: 'bad "x"' })
  assert.match(h, /^Bearer resource_metadata="https:\/\/www\.velocity-stack\.app\/\.well-known\/oauth-protected-resource\/api\/mcp"/)
  assert.match(h, /error="invalid_token"/)
  assert.ok(!/bad "x"/.test(h))
})

// ---- Views ----------------------------------------------------------------------------------------

test('splits average the streams per block and stay bounded', () => {
  const watts = Array.from({ length: 600 }, (_, i) => (i < 300 ? 200 : 300))
  const { split_s, splits } = computeSplits({ watts, heartrate: Array(600).fill(140), latitude: [1], longitude: [2] }, 5)
  assert.equal(split_s, 300)
  assert.deepEqual(splits.map((s) => s.avg_power_w), [200, 300])
  assert.equal(splits[0].avg_hr_bpm, 140)
  assert.ok(!JSON.stringify(splits).includes('latitude'))
  const long = computeSplits({ watts: Array(60 * 60 * 24).fill(100) }, 1)
  assert.ok(long.splits.length <= MAX_SPLITS)
  assert.deepEqual(computeSplits(null), { split_s: null, splits: [] })
})

test('template runs and activities are compact and GPS-free', () => {
  const run = templateRunView({ id: 'r', template_name: 'VO2', summary: { avg_power: 320.456, laps: [1, 2] }, efforts: [{ avg_power: 330, series: [1, 2, 3], latitude: [1] }] })
  assert.deepEqual(run.summary, { avg_power: 320.46 })
  assert.deepEqual(run.efforts, [{ avg_power: 330 }])
  const a = activitySummaryView({ id: 'a', title: 'Ride', activity_date: '2026-11-20T07:00:00+00:00', distance_m: 42195, time_series: { latitude: [1] } })
  assert.equal(a.distance_km, 42.2)
  assert.equal(a.date, '2026-11-20')
  assert.ok(!('time_series' in a))
})

test('fitness view and small helpers', () => {
  const v = fitnessView({ empty: false, fitness: 50, fatigue: 60, form: -10, status: { label: 'Neutral' }, ramp: 3, rampLevel: null, building: false, estimateShare: 0.123, series: [{ day: 'a', load: 1, fitness: 1, fatigue: 1, form: 0, estimatedLoad: 0 }, { day: 'b', load: 2, fitness: 2, fatigue: 2, form: 0 }] }, 1)
  assert.equal(v.series.length, 1)
  assert.equal(v.hr_estimated_share, 0.12)
  assert.equal(fitnessView({ empty: true }).empty, true)
  assert.equal(nextDay('2026-12-31'), '2027-01-01')
  assert.equal(safeLike('50%,vo2*'), '50  vo2')
})

// ---- Migration ----------------------------------------------------------------------------------

for (const [file, min] of [['20270190000000_mcp_connector.sql', 9], ['20270191000000_mcp_races_notes.sql', 8]]) test(`MCP wrappers in ${file} are SECURITY DEFINER and executable by the service role only`, () => {
  const sql = readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8')
  const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(mcp_\w+)\(/g)].map((m) => m[1])
  assert.ok(fns.length >= min)
  assert.equal((sql.match(/SECURITY DEFINER/g) || []).length, fns.length)
  for (const f of fns) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`), f)
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO service_role;`), f)
  }
  assert.ok(!/TO (authenticated|anon)\b/.test(sql))
  // Every wrapper derives the user from the token; none accepts a user id to act as from outside.
  for (const f of fns.filter((n) => !['mcp_token_user', 'mcp_act_as'].includes(n))) {
    const body = sql.slice(sql.indexOf(`FUNCTION public.${f}(`))
    assert.match(body.slice(0, body.indexOf('$$;')), /mcp_(token_user|resolve_rider)\(p_token_hash/, f)
  }
})
