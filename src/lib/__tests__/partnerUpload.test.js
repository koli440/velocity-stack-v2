import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseJsonUpload, parseGpx, parseTcx, validateExternalId, validateSport, validateStartTime, localStamp, UploadValidationError,
} from '../partnerUpload.js'
import { createPartnerProvider } from '../server/partnerProvider.js'
import { processUpload } from '../server/partnerUploads.js'
import { sourcePriority } from '../activityDuplicates.js'

const NOW = Date.parse('2026-11-04T12:00:00Z')
const arr = (n, f) => Array.from({ length: n }, (_, i) => f(i))
const body = (over = {}) => ({
  external_id: 'ride-1',
  start_time: '2026-11-04T07:30:00+01:00',
  title: 'AI Ain Virtual Cycling',
  streams: { power: arr(600, (i) => 150 + (i % 50)), heart_rate: arr(600, () => 140), cadence: arr(600, () => 85), speed: arr(600, () => 9) },
  ...over,
})
const invalid = (fn, re) => assert.throws(fn, (e) => e instanceof UploadValidationError && (!re || re.test(e.message)))

test('json upload: validates and normalises', () => {
  const p = parseJsonUpload(body(), NOW)
  assert.equal(p.externalId, 'ride-1')
  assert.equal(p.sport, 'virtual')
  assert.equal(p.start.iso, '2026-11-04T06:30:00.000Z')
  assert.equal(localStamp(p.start.iso, p.start.offsetMin), '2026-11-04T07:30:00')
  assert.deepEqual(p.streams.map((s) => s.type), ['watts', 'heartrate', 'cadence', 'velocity_smooth'])
})

test('json upload: rejects bad input', () => {
  invalid(() => validateExternalId('bad id!'), /external_id/)
  invalid(() => validateSport('run'), /sport/)
  invalid(() => validateStartTime('2026-11-04 07:30', NOW), /ISO/)
  invalid(() => validateStartTime('2027-01-01T00:00:00Z', NOW), /range/)
  invalid(() => parseJsonUpload(body({ streams: { power: [1, 2, 3] } }), NOW), /at least/i)
  invalid(() => parseJsonUpload(body({ streams: { power: arr(100, () => 1), heart_rate: arr(99, () => 1) } }), NOW), /expected 100/)
  invalid(() => parseJsonUpload(body({ streams: { power: arr(100, () => 9999) } }), NOW), /outside/)
  invalid(() => parseJsonUpload(body({ streams: { nope: arr(100, () => 1) } }), NOW), /Unknown/)
  invalid(() => parseJsonUpload(body({ streams: { cadence: arr(100, () => 1) } }), NOW), /at least one of/i)
  assert.throws(() => parseJsonUpload(body({ streams: { power: arr(50001, () => 1) } }), NOW), (e) => e.status === 413)
})

const gpx = (n) => `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${arr(n, (i) =>
  `<trkpt lat="52.${i}" lon="4.5"><ele>${10 + i}</ele><time>${new Date(Date.UTC(2026, 10, 4, 7, 0, i * 2)).toISOString()}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr><gpxtpx:cad>80</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>`).join('')}</trkseg></trk></gpx>`
const tcx = (n) => `<TrainingCenterDatabase><Activities><Activity Sport="Biking"><Lap><Track>${arr(n, (i) =>
  `<Trackpoint><Time>${new Date(Date.UTC(2026, 10, 4, 7, 0, i)).toISOString()}</Time><DistanceMeters>${i * 8}</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm><Cadence>90</Cadence><Extensions><TPX><Watts>200</Watts></TPX></Extensions></Trackpoint>`).join('')}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`

test('gpx and tcx convert to 1 Hz streams', () => {
  const g = parseGpx(gpx(100))
  assert.equal(g.samples, 199)
  assert.ok(g.streams.find((s) => s.type === 'heartrate').data.every((v) => v === 140))
  assert.ok(g.streams.find((s) => s.type === 'latlng'))
  const t = parseTcx(tcx(120))
  assert.equal(t.samples, 120)
  assert.equal(t.streams.find((s) => s.type === 'watts').data[5], 200)
  assert.equal(t.streams.find((s) => s.type === 'distance').data[119], 952)
})

test('xml with entities or short tracks is rejected', () => {
  invalid(() => parseGpx('<!DOCTYPE x [<!ENTITY a "b">]><gpx></gpx>'), /DOCTYPE/)
  invalid(() => parseTcx('<foo/>'), /TCX/)
  invalid(() => parseTcx(tcx(10)), /short/)
})

test('partner provider analyses JSON streams as a virtual ride with the partner external source', async () => {
  const p = parseJsonUpload(body(), NOW)
  const provider = createPartnerProvider({ slug: 'pedalmania', input: { kind: 'json', streams: p.streams, samples: p.samples, start: p.start }, title: p.title, sport: p.sport })
  assert.equal(provider.externalSource, 'partner:pedalmania')
  const r = await provider.fetchActivity('ride-1')
  assert.equal(r.sport, 'virtual')
  assert.equal(r.startDateLocal, '2026-11-04T07:30:00')
  assert.equal(r.summary.start_time, '2026-11-04T06:30:00.000Z')
  assert.equal(r.summary.elapsed_time_s, 600)
  assert.ok(r.summary.avg_power_w > 150 && r.summary.normalized_power_w)
})

test('partner source priority equals Strava', () => {
  assert.equal(sourcePriority('partner'), sourcePriority('strava'))
})

// ---- processUpload with an in-memory service client ----

function memService() {
  const uploads = []
  const activities = []
  const audit = []
  const thenable = (data) => ({ then: (r) => r({ data, error: null }), maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] ?? null : data, error: null }) })
  return {
    uploads, activities, audit,
    from(table) {
      if (table === 'partner_uploads') {
        return {
          insert: (row) => ({
            select: () => ({
              single: async () => {
                if (uploads.some((u) => u.app_id === row.app_id && u.user_id === row.user_id && u.external_id === row.external_id)) return { data: null, error: { code: '23505' } }
                const r = { id: `u${uploads.length + 1}`, status: 'processing', activity_id: null, error: null, created_at: 'now', ...row }
                uploads.push(r)
                return { data: r, error: null }
              },
            }),
          }),
          select: () => ({ match: (m) => ({ maybeSingle: async () => ({ data: uploads.find((u) => Object.entries(m).every(([k, v]) => u[k] === v)) || null }) }) }),
          update: (patch) => ({ eq: (_c, id) => ({ select: () => ({ single: async () => { const u = uploads.find((x) => x.id === id); Object.assign(u, patch); return { data: u, error: null } } }) }) }),
        }
      }
      if (table === 'partner_audit_log') return { insert: async (r) => { audit.push(r); return { error: null } } }
      if (table === 'activities') {
        return {
          select: () => ({ eq: () => thenable(activities) }),
          insert: (rows) => ({ select: () => ({ single: async () => { const a = { id: `a${activities.length + 1}`, ...rows[0] }; activities.push(a); return { data: a, error: null } } }), then: (r) => r({ error: null }) }),
          delete: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      return { select: () => ({ eq: () => thenable([]), order: () => thenable([]) }), insert: () => ({ then: (r) => r({ error: null }) }) }
    },
    rpc: async () => ({ data: 1, error: null }),
  }
}

const auth = { userId: 'user-1', appId: 'app-1', scopes: ['activities:write'], app: { id: 'app-1', slug: 'pedalmania' } }
const jsonRequest = () => {
  const p = parseJsonUpload(body(), NOW)
  return { kind: 'json', externalId: p.externalId, title: p.title, sport: p.sport, input: { kind: 'json', streams: p.streams, samples: p.samples, start: p.start } }
}
const quiet = { info() {}, warn() {} }

test('processUpload imports once and replays the same external_id', async () => {
  const service = memService()
  const first = await processUpload({ service, auth, request: jsonRequest(), log: quiet })
  assert.equal(first.replay, false)
  assert.equal(first.row.status, 'completed')
  assert.equal(service.activities.length, 1)
  const a = service.activities[0]
  assert.equal(a.source, 'partner')
  assert.equal(a.external_source, 'partner:pedalmania')
  assert.equal(a.external_id, 'ride-1')
  assert.equal(a.user_id, 'user-1')
  assert.equal(a.ride_type, 'virtual')
  assert.equal(a.title, 'AI Ain Virtual Cycling')
  const second = await processUpload({ service, auth, request: jsonRequest(), log: quiet })
  assert.equal(second.replay, true)
  assert.equal(service.activities.length, 1)
  assert.ok(service.audit.some((e) => e.event === 'upload_completed'))
})

test('processUpload records a failed upload and allows a retry', async () => {
  const service = memService()
  const bad = { ...jsonRequest(), input: { kind: 'fit', blob: new Blob(['x']), filename: 'x.fit' } }
  const failed = await processUpload({ service, auth, request: bad, analyzeFit: async () => null, log: quiet })
  assert.equal(failed.row.status, 'failed')
  const retry = await processUpload({ service, auth, request: jsonRequest(), log: quiet })
  assert.equal(retry.replay, false)
  assert.equal(retry.row.status, 'completed')
  assert.equal(service.uploads.length, 1)
})

test('processUpload accepts a .fit file via the analyzer and rejects runs', async () => {
  const service = memService()
  const fit = (sport) => async () => ({
    success: true,
    summary: { start_time: '2026-11-04T06:30:00Z', elapsed_time_s: 900, avg_power_w: 180, sport },
    curves: {}, time_series: {},
  })
  const req = { ...jsonRequest(), kind: 'fit', sport: null, input: { kind: 'fit', blob: new Blob(['fit']), filename: 'r.fit' } }
  const ok = await processUpload({ service, auth, request: req, analyzeFit: fit('cycling'), log: quiet })
  assert.equal(ok.row.status, 'completed')
  const run = await processUpload({ service, auth, request: { ...req, externalId: 'run-1' }, analyzeFit: fit('running'), log: quiet })
  assert.equal(run.row.status, 'failed')
  assert.match(run.row.error, /cycling/)
})
