import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  groupRelationships,
  otherId,
  replacementWarning,
  profileCoachingActions,
  coachingErrorMessage,
  fetchMyCoaching,
  fetchCoachingStatus,
  acceptCoaching,
  fetchAthleteProfile,
} from '../coaching.js'
import { describeNotification, notificationHref } from '../notifications.js'
import { fetchActivitiesInRange } from '../calendar.js'

const rows = [
  { id: '1', coach_id: 'c1', rider_id: 'me', status: 'active', initiated_by: 'c1' },
  { id: '2', coach_id: 'me', rider_id: 'a1', status: 'active', initiated_by: 'me' },
  { id: '3', coach_id: 'c2', rider_id: 'me', status: 'pending', initiated_by: 'c2' },
  { id: '4', coach_id: 'c3', rider_id: 'me', status: 'pending', initiated_by: 'me' },
  { id: '5', coach_id: 'me', rider_id: 'a2', status: 'pending', initiated_by: 'a2' },
  { id: '6', coach_id: 'me', rider_id: 'a3', status: 'pending', initiated_by: 'me' },
  { id: '7', coach_id: 'x', rider_id: 'y', status: 'active', initiated_by: 'x' },
]

test('groupRelationships sorts rows by role and direction', () => {
  const g = groupRelationships(rows, 'me')
  assert.equal(g.coach.id, '1')
  assert.deepEqual(g.athletes.map((r) => r.id), ['2'])
  assert.deepEqual(g.incomingInvites.map((r) => r.id), ['3'])
  assert.deepEqual(g.outgoingRequests.map((r) => r.id), ['4'])
  assert.deepEqual(g.incomingRequests.map((r) => r.id), ['5'])
  assert.deepEqual(g.outgoingInvites.map((r) => r.id), ['6'])
  assert.equal(groupRelationships(null, 'me').coach, null)
})

test('otherId returns the counterpart', () => {
  assert.equal(otherId(rows[0], 'me'), 'c1')
  assert.equal(otherId(rows[1], 'me'), 'a1')
})

test('replacementWarning names the coach being replaced, null when nobody is', () => {
  assert.equal(replacementWarning({ newCoachName: 'Bo' }), null)
  const w = replacementWarning({ currentCoachName: 'Ann', newCoachName: 'Bo' })
  assert.match(w, /replace Ann/)
  assert.match(w, /Bo will be able to read/)
  assert.match(w, /private activities/)
})

test('profileCoachingActions per relationship state', () => {
  assert.deepEqual(
    [profileCoachingActions('none').invite, profileCoachingActions('none').request],
    [true, true]
  )
  const withCoach = profileCoachingActions('none', { viewerHasCoach: true })
  assert.equal(withCoach.request, false)
  assert.ok(withCoach.hint)
  assert.equal(profileCoachingActions('invited').cancel, true)
  assert.equal(profileCoachingActions('invite_received').accept, true)
  assert.equal(profileCoachingActions('coach').end, true)
  assert.equal(profileCoachingActions('self').invite, false)
})

test('coachingErrorMessage hides internals', () => {
  assert.match(coachingErrorMessage({ message: 'A coaching request is already pending with this rider' }), /already pending/)
  assert.equal(coachingErrorMessage({ message: 'Rider not found' }), 'This request is no longer available.')
  assert.match(coachingErrorMessage({ message: 'duplicate key value violates unique constraint' }), /try again/)
})

test('coaching notifications are described and link to settings when actionable', () => {
  const actor = { display_name: 'ann' }
  assert.equal(describeNotification({ type: 'coach_invite' }, actor), 'ann invited you to be their athlete')
  assert.equal(describeNotification({ type: 'coach_request' }, actor), 'ann asked you to be their coach')
  assert.match(describeNotification({ type: 'coach_replaced' }, actor), /no longer have access/)
  assert.match(describeNotification({ type: 'coach_ended' }, actor), /ended/)
  assert.match(describeNotification({ type: 'coach_accepted' }, actor), /accepted/)
  assert.equal(notificationHref({ type: 'coach_invite' }), '/settings#coaching')
  assert.equal(notificationHref({ type: 'new_follower' }), null)
})

function rpcClient(result, calls = []) {
  return {
    calls,
    rpc: async (name, args) => (calls.push([name, args]), result[name] ?? { data: null, error: null }),
    from() {
      const b = new Proxy({}, {
        get: (_, op) => (op === 'then' ? (res) => res({ data: [], error: null }) : () => b),
      })
      return b
    },
  }
}

test('RPC wrappers call the expected functions', async () => {
  const c = rpcClient({
    my_coaching: { data: [rows[0]], error: null },
    coaching_status_with: { data: [{ id: 'r1', status: 'invited' }], error: null },
    get_athlete_profile: { data: [{ id: 'a1' }], error: null },
  })
  const my = await fetchMyCoaching(c, 'me')
  assert.equal(my.rows.length, 1)
  assert.deepEqual(await fetchCoachingStatus(c, 'x'), { id: 'r1', status: 'invited', error: null })
  assert.equal((await fetchAthleteProfile(c, 'a1')).athlete.id, 'a1')
  await acceptCoaching(c, 'rel')
  assert.deepEqual(c.calls.at(-1), ['accept_coaching', { p_id: 'rel' }])
  assert.deepEqual(await fetchCoachingStatus(c, null), { id: null, status: 'none', error: null })
})

test('calendar reads athletes through the masked shared view', async () => {
  const tables = []
  const client = {
    from(t) {
      tables.push(t)
      const b = new Proxy({}, { get: (_, op) => (op === 'then' ? (r) => r({ data: [], error: null }) : () => b) })
      return b
    },
  }
  await fetchActivitiesInRange(client, { riderId: 'a', startISO: 'x', endISO: 'y', shared: true })
  await fetchActivitiesInRange(client, { riderId: 'a', startISO: 'x', endISO: 'y' })
  assert.deepEqual(tables, ['shared_activities', 'activities'])
})

// ---- Migration guardrails ---------------------------------------------------------------
const sql = readFileSync(
  new URL('../../../supabase/migrations/20261129000000_coaching_relationships.sql', import.meta.url),
  'utf8'
)

test('migration: RLS on, no client table privileges, unique indexes', () => {
  assert.match(sql, /ALTER TABLE public\.coaching_relationships ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public\.coaching_relationships FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /uq_coaching_one_active_coach[\s\S]*?\(rider_id\) WHERE status = 'active'/)
  assert.match(sql, /uq_coaching_one_pending_pair[\s\S]*?\(coach_id, rider_id\) WHERE status = 'pending'/)
  assert.doesNotMatch(sql, /GRANT (SELECT|INSERT|UPDATE|DELETE)[^;]*coaching_relationships/)
})

test('migration: coaches never read raw activities, coordinates stay masked', () => {
  assert.doesNotMatch(sql, /ON public\.activities FOR SELECT/)
  const view = sql.match(/CREATE VIEW public\.shared_activities AS[\s\S]*?GRANT SELECT ON public\.shared_activities/)[0]
  assert.match(view, /a\.time_series - 'latitude' - 'longitude'/)
  assert.match(view, /zone_signature/)
  assert.doesNotMatch(view, /raw_file_url|file_sha256|privacy_zone_lat,\s*\n?\s*p\./)
  assert.match(view, /public\.is_coach_of\(a\.user_id\)/)
})

test('migration: never exposes secrets and every SECURITY DEFINER function pins search_path', () => {
  assert.doesNotMatch(sql, /profile_secrets|public\.connections|auth\.users/)
  const defs = sql.match(/LANGUAGE (sql|plpgsql)[^$]*SECURITY DEFINER[^$]*\$\$/g) || []
  assert.ok(defs.length >= 10)
  for (const d of defs) assert.match(d, /SET search_path = public/)
})

test('migration: accept swaps the previous coach and notifies; decline is silent', () => {
  const accept = sql.match(/FUNCTION public\.accept_coaching[\s\S]*?\$\$;\n/)[0]
  assert.match(accept, /pg_advisory_xact_lock/)
  assert.match(accept, /'coach_replaced'/)
  const decline = sql.match(/FUNCTION public\.decline_coaching[\s\S]*?\$\$;\n/)[0]
  assert.doesNotMatch(decline, /notifications/)
  assert.match(sql, /trg_end_coaching_on_block/)
})
