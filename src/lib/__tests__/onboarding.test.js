import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeSupabase } from './helpers/fakeSupabase.js'
import {
  CHECKLIST_ITEMS,
  WELCOME_STEPS,
  EMPTY_FACTS,
  evaluateChecklist,
  shouldShowChecklist,
  fetchOnboardingFacts,
} from '../onboarding.js'
import { fetchOnboardingState, updateOnboardingState, shouldShowWelcome, unseenFor, markSeenPatch } from '../onboardingState.js'
import { chromeVisibility } from '../coachContext.js'

test('checklist rules tick from real data', () => {
  const empty = evaluateChecklist(null)
  assert.equal(empty.doneCount, 0)
  assert.equal(empty.complete, false)
  assert.equal(empty.total, CHECKLIST_ITEMS.length)
  const partial = evaluateChecklist({ hasConnection: true, activityCount: 3, hasFtp: true })
  assert.deepEqual(partial.items.filter((i) => i.done).map((i) => i.id), ['source', 'ride', 'ftp'])
  const full = evaluateChecklist({ hasConnection: true, activityCount: 1, hasFtp: true, hasWeight: true, templateRunCount: 2, hasPrivacyZone: true })
  assert.equal(full.complete, true)
  assert.equal(evaluateChecklist({ templateRunCount: 0 }).items.find((i) => i.id === 'template').done, false)
})

test('checklist card shows until complete or dismissed', () => {
  const open = { onboarding_dismissed_at: null }
  assert.equal(shouldShowChecklist(open, evaluateChecklist(EMPTY_FACTS)), true)
  assert.equal(shouldShowChecklist({ onboarding_dismissed_at: '2026-12-01' }, evaluateChecklist(EMPTY_FACTS)), false)
  const all = evaluateChecklist({ hasConnection: true, activityCount: 1, hasFtp: true, hasWeight: true, templateRunCount: 1, hasPrivacyZone: true })
  assert.equal(shouldShowChecklist(open, all), false)
  assert.equal(shouldShowChecklist(null, evaluateChecklist(EMPTY_FACTS)), false)
})

test('welcome appears once for new accounts only', () => {
  assert.equal(shouldShowWelcome({ welcome_seen_at: null, onboarding_dismissed_at: null }), true)
  assert.equal(shouldShowWelcome({ welcome_seen_at: 'x', onboarding_dismissed_at: null }), false)
  // existing users are initialised as dismissed: never forced through onboarding
  assert.equal(shouldShowWelcome({ welcome_seen_at: 'x', onboarding_dismissed_at: 'x' }), false)
  assert.equal(shouldShowWelcome({ welcome_seen_at: null, onboarding_dismissed_at: 'x' }), false)
  assert.equal(shouldShowWelcome(null), false)
})

test('welcome copy covers the required topics and only uses safe links', () => {
  const text = WELCOME_STEPS.map((s) => `${s.title} ${s.body}`).join(' ').toLowerCase()
  for (const w of ['intervals.icu', 'ftp', 'weight', 'coach', 'privacy', 'template', 'personal best']) assert.ok(text.includes(w), w)
  const hrefs = WELCOME_STEPS.flatMap((s) => (s.links || []).map((l) => l.href))
  assert.ok(hrefs.includes('/dsl-guide'))
  for (const h of hrefs) assert.match(h, /^\//)
})

test('unseen news and mark-seen patch', () => {
  const entries = [{ id: '2026-12-01-a' }, { id: '2026-12-12-b' }]
  const state = { news_seen_through: '2026-12-11~' }
  assert.deepEqual(unseenFor(state, entries).map((e) => e.id), ['2026-12-12-b'])
  assert.deepEqual(unseenFor(null, entries), [])
  assert.deepEqual(markSeenPatch(state, entries), { news_seen_through: '2026-12-12-b' })
  assert.deepEqual(markSeenPatch({ news_seen_through: '2027-01-01-z' }, entries), { news_seen_through: '2027-01-01-z' })
})

test('state reads and writes are always scoped to the signed-in user, never another id', async () => {
  const sb = fakeSupabase({
    user_onboarding_state: [
      { user_id: 'me', welcome_seen_at: null, onboarding_dismissed_at: null, news_seen_through: '' },
      { user_id: 'athlete', welcome_seen_at: 'x', onboarding_dismissed_at: 'x', news_seen_through: 'zzz' },
    ],
  })
  const { state } = await fetchOnboardingState(sb, 'me')
  assert.equal(state.user_id, 'me')
  await updateOnboardingState(sb, 'me', { welcome_seen_at: 'now', user_id: 'athlete', evil: 1 })
  assert.equal(sb.db.user_onboarding_state[0].welcome_seen_at, 'now')
  assert.equal(sb.db.user_onboarding_state[0].user_id, 'me')
  assert.equal(sb.db.user_onboarding_state[0].evil, undefined)
  assert.equal(sb.db.user_onboarding_state[1].welcome_seen_at, 'x')
  await assert.rejects(() => fetchOnboardingState(sb, ''), /owner id/)
  await assert.rejects(async () => updateOnboardingState(sb, null, {}), /owner id/)
})

test('a missing row is created through the RPC (own row only)', async () => {
  const rows = []
  const sb = {
    from: () => ({
      select: () => ({ eq: (c, v) => ({ maybeSingle: async () => ({ data: rows.find((r) => r[c] === v) || null, error: null }) }) }),
    }),
    rpc: async (name) => {
      assert.equal(name, 'ensure_my_onboarding_state')
      rows.push({ user_id: 'me', welcome_seen_at: null, onboarding_dismissed_at: null, news_seen_through: '2026-12-11~' })
      return { error: null }
    },
  }
  const { state, error } = await fetchOnboardingState(sb, 'me')
  assert.equal(error, null)
  assert.equal(state.news_seen_through, '2026-12-11~')
})

test('checklist facts filter every own-data query by the signed-in user', async () => {
  const calls = []
  const chain = (table) => {
    const q = {
      select: () => q,
      eq: (c, v) => (calls.push([table, c, v]), q),
      neq: () => q,
      maybeSingle: async () => ({ data: { ftp_w: 250, privacy_zone_lat: null, privacy_zone_lng: null }, error: null }),
      then: (res) => Promise.resolve({ count: table === 'activities' ? 2 : 0, error: null }).then(res),
    }
    return q
  }
  const facts = await fetchOnboardingFacts({ from: chain }, 'me')
  for (const t of ['connections', 'activities', 'ftp_history', 'weight_history', 'template_executions']) {
    assert.ok(calls.some(([table, c, v]) => table === t && c === 'user_id' && v === 'me'), `${t} not scoped`)
  }
  assert.ok(calls.some(([t, c, v]) => t === 'profiles' && c === 'id' && v === 'me'))
  assert.deepEqual(facts, { hasConnection: false, activityCount: 2, hasFtp: true, hasWeight: false, templateRunCount: 0, hasPrivacyZone: false })
})

test('help menu is hidden in athlete context', () => {
  assert.equal(chromeVisibility(null).help, true)
  assert.equal(chromeVisibility('rider-1').help, false)
})
