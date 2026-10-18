import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMENT_MAX_LENGTH,
  activeMentionQuery,
  shouldFetchMentions,
  mentionHandle,
  foldHandle,
  profileMentionHandle,
  popoverPlacement,
  mentionStatusText,
  activityCommentsHref,
  addActivityComment,
  applyMention,
  commentCountLabel,
  commentErrorMessage,
  fetchActivityComments,
  fetchCommentInfo,
  isValidCommentBody,
  relativeTime,
  searchMentionCandidates,
  splitCommentBody,
} from '../activityComments.js'

test('isValidCommentBody enforces 1..2000 trimmed characters', () => {
  assert.equal(isValidCommentBody('  '), false)
  assert.equal(isValidCommentBody(null), false)
  assert.equal(isValidCommentBody(' hi '), true)
  assert.equal(isValidCommentBody('a'.repeat(COMMENT_MAX_LENGTH)), true)
  assert.equal(isValidCommentBody('a'.repeat(COMMENT_MAX_LENGTH + 1)), false)
})

test('commentErrorMessage maps database errors to rider-friendly text', () => {
  assert.match(commentErrorMessage({ message: 'Comment limit reached (30 per hour), try again later' }), /too fast/)
  assert.match(commentErrorMessage({ message: 'Comments are turned off for this activity' }), /turned off/)
  assert.match(commentErrorMessage({ message: 'Activity not found' }), /no longer available/)
  assert.match(commentErrorMessage({ message: 'boom' }), /Something went wrong/)
})

test('commentCountLabel pluralises', () => {
  assert.equal(commentCountLabel(1), '1 comment')
  assert.equal(commentCountLabel(0), '0 comments')
  assert.equal(commentCountLabel(12), '12 comments')
})

test('relativeTime buckets', () => {
  const now = Date.parse('2026-10-18T12:00:00Z')
  assert.equal(relativeTime('2026-10-18T11:59:40Z', now), 'just now')
  assert.equal(relativeTime('2026-10-18T11:30:00Z', now), '30m ago')
  assert.equal(relativeTime('2026-10-18T09:00:00Z', now), '3h ago')
  assert.equal(relativeTime('2026-10-16T12:00:00Z', now), '2d ago')
  assert.equal(relativeTime('nope', now), '')
})

test('activeMentionQuery finds the handle at the caret', () => {
  assert.deepEqual(activeMentionQuery('hi @jo', 6), { start: 3, query: 'jo' })
  assert.deepEqual(activeMentionQuery('@a', 2), { start: 0, query: 'a' })
  assert.deepEqual(activeMentionQuery('hi @', 4), { start: 3, query: '' })
  assert.equal(activeMentionQuery('mail me@example', 15), null)
  assert.equal(activeMentionQuery('hi @jo and', 10), null)
  assert.deepEqual(activeMentionQuery('hi @jo and', 6), { start: 3, query: 'jo' })
  assert.equal(activeMentionQuery('plain', 5), null)
})

test('applyMention swaps the typed query for the nickname', () => {
  const text = 'hi @jo and'
  const m = activeMentionQuery(text, 6)
  assert.deepEqual(applyMention(text, m, 6, 'john_d'), { text: 'hi @john_d  and', caret: 11 })
})

test('splitCommentBody links only notified mentions', () => {
  const mentions = new Map([['ann', 'u1']])
  assert.deepEqual(splitCommentBody('hey @Ann, nice! @bob', mentions), [
    { type: 'text', text: 'hey ' },
    { type: 'mention', text: '@Ann', userId: 'u1' },
    { type: 'text', text: ', nice! @bob' },
  ])
  assert.deepEqual(splitCommentBody('x@ann <b>hi</b>', mentions), [{ type: 'text', text: 'x@ann <b>hi</b>' }])
  assert.deepEqual(splitCommentBody('@ann.', mentions), [
    { type: 'mention', text: '@ann', userId: 'u1' },
    { type: 'text', text: '.' },
  ])
  assert.deepEqual(splitCommentBody('', mentions), [])
  assert.deepEqual(splitCommentBody('@ann', undefined), [{ type: 'text', text: '@ann' }])
})

test('activityCommentsHref keeps the coach in the athlete context', () => {
  assert.equal(activityCommentsHref('a1', { viewer_is_coach: false, owner_id: 'r1' }), '/activities/a1#comments')
  assert.equal(activityCommentsHref('a1', { viewer_is_coach: true, owner_id: 'r1' }), '/coach/r1/activities/a1#comments')
  assert.equal(activityCommentsHref(null, null), null)
})

function rpcClient(handler) {
  const calls = []
  return {
    calls,
    rpc: async (name, args) => (calls.push([name, args]), handler(name, args)),
  }
}

test('fetchCommentInfo indexes by activity and skips empty input', async () => {
  const c = rpcClient(() => ({ data: [{ activity_id: 'a1', comment_count: 2 }], error: null }))
  const { info } = await fetchCommentInfo(c, ['a1', 'a1', null])
  assert.equal(info.get('a1').comment_count, 2)
  assert.deepEqual(c.calls[0], ['activity_comment_info', { p_ids: ['a1'] }])
  assert.equal((await fetchCommentInfo(c, [])).info.size, 0)
  assert.equal(c.calls.length, 1)
  const failing = rpcClient(() => ({ data: null, error: new Error('x') }))
  assert.ok((await fetchCommentInfo(failing, ['a'])).error)
})

test('addActivityComment trims the body and passes reply_to', async () => {
  const c = rpcClient(() => ({ data: 'c1', error: null }))
  const res = await addActivityComment(c, { activityId: 'a1', body: ' hi ' })
  assert.equal(res.id, 'c1')
  assert.deepEqual(c.calls[0], ['add_activity_comment', { p_activity: 'a1', p_body: 'hi', p_reply_to: null }])
})

test('searchMentionCandidates returns rows or the error', async () => {
  const c = rpcClient(() => ({ data: [{ id: 'u1', nickname: 'ann' }], error: null }))
  assert.equal((await searchMentionCandidates(c, { activityId: 'a1', query: 'a' })).candidates[0].nickname, 'ann')
  const failing = rpcClient(() => ({ data: null, error: new Error('x') }))
  assert.deepEqual((await searchMentionCandidates(failing, { activityId: 'a1', query: 'a' })).candidates, [])
})

test('fetchActivityComments joins authors and per-comment mentions', async () => {
  const tables = {
    activity_comments: { data: [{ id: 'c1', user_id: 'u1', body: 'hi @bob' }], error: null },
    activity_comment_mentions: { data: [{ comment_id: 'c1', user_id: 'u2' }], error: null },
    public_profiles: { data: [{ id: 'u1', nickname: 'ann' }, { id: 'u2', nickname: 'Bob' }], error: null },
  }
  const client = {
    from(table) {
      const b = new Proxy({}, {
        get(_, op) {
          if (op === 'then') return (resolve) => resolve(tables[table])
          return () => b
        },
      })
      return b
    },
  }
  const { comments, profiles, mentions, error } = await fetchActivityComments(client, 'a1')
  assert.equal(error, null)
  assert.equal(comments.length, 1)
  assert.equal(profiles.get('u1').nickname, 'ann')
  assert.equal(mentions.get('c1').get('bob'), 'u2')
})

test('moderation helpers call the right endpoints', async () => {
  const calls = []
  const client = {
    rpc: async (n, a) => (calls.push([n, a]), { data: [{ id: 'r1' }], error: null }),
    from: (t) => {
      const b = new Proxy({}, {
        get(_, op) {
          if (op === 'then') return (res) => res({ data: [{ id: 'a1' }], error: null })
          return (...args) => (calls.push([t, op, ...args]), b)
        },
      })
      return b
    },
  }
  const { reportActivityComment, fetchCommentReports, resolveCommentReport, setCommentsEnabled } = await import('../activityComments.js')
  await reportActivityComment(client, { commentId: 'c1', reason: '  spam ' })
  assert.deepEqual(calls[0], ['report_activity_comment', { p_comment: 'c1', p_reason: 'spam' }])
  assert.equal((await fetchCommentReports(client)).reports.length, 1)
  await resolveCommentReport(client, { reportId: 'r1', remove: true })
  assert.deepEqual(calls[2], ['admin_resolve_comment_report', { p_report: 'r1', p_remove: true }])
  assert.equal((await setCommentsEnabled(client, { activityId: 'a1', enabled: false })).error, null)
  assert.ok(calls.some((c) => c[0] === 'activities' && c[1] === 'update' && c[2].comments_enabled === false))
  assert.match(commentErrorMessage({ message: 'Report limit reached' }), /too many/)
})

test('unread helpers map rpc rows and skip empty input', async () => {
  const { fetchUnreadCounts, fetchCoachUnreadComments, markCommentsRead } = await import('../activityComments.js')
  const calls = []
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args])
      if (name === 'activity_comment_unread') return { data: [{ activity_id: 'a1', unread_count: 2 }], error: null }
      if (name === 'coach_unread_comments') return { data: [{ rider_id: 'r1', unread_count: 3 }], error: null }
      return { data: null, error: null }
    },
  }
  assert.equal((await fetchUnreadCounts(client, [])).counts.size, 0)
  assert.equal((await fetchUnreadCounts(client, ['a1'])).counts.get('a1'), 2)
  assert.equal((await fetchCoachUnreadComments(client)).counts.get('r1'), 3)
  await markCommentsRead(client, 'a1')
  assert.deepEqual(calls.at(-1), ['mark_activity_comments_read', { p_activity: 'a1' }])
})

test('a bare @ opens mention suggestions immediately', () => {
  const m = activeMentionQuery('hi @', 4)
  assert.deepEqual(m, { start: 3, query: '' })
  assert.equal(shouldFetchMentions(m.query), true)
  assert.equal(shouldFetchMentions(activeMentionQuery('hi', 2)?.query ?? null), false)
  assert.equal(shouldFetchMentions(activeMentionQuery('mail@', 5)?.query ?? null), false)
  assert.equal(shouldFetchMentions(activeMentionQuery('@jo', 3).query), true)
})

test('searchMentionCandidates sends an empty query for a bare @', async () => {
  let args
  const client = { rpc: async (name, a) => { args = [name, a]; return { data: [{ id: 'u', nickname: 'coach' }], error: null } } }
  const { candidates } = await searchMentionCandidates(client, { activityId: 'a1', query: '' })
  assert.deepEqual(args, ['activity_mention_candidates', { p_activity: 'a1', p_query: '' }])
  assert.equal(candidates.length, 1)
})

test('mentionHandle turns free-text nicknames into typeable handles', () => {
  assert.equal(mentionHandle('Koen Olijslagers'), 'KoenOlijslagers')
  assert.equal(mentionHandle('José R.'), 'JoséR')
  assert.equal(mentionHandle('anna_k-'), 'anna_k')
  assert.equal(mentionHandle('🚴'), null)
  assert.equal(mentionHandle(null), null)
  assert.equal(mentionHandle('x'.repeat(60)).length, 40)
})

test('activeMentionQuery and splitCommentBody handle accented handles', () => {
  assert.deepEqual(activeMentionQuery('hi @Jos', 7), { start: 3, query: 'Jos' })
  const parts = splitCommentBody('hi @JoséR!', new Map([[foldHandle('JoséR'), 'u1']]))
  assert.deepEqual(parts.filter((p) => p.type === 'mention'), [{ type: 'mention', text: '@JoséR', userId: 'u1' }])
})

test('mentionStatusText explains empty and failed lookups', () => {
  assert.equal(mentionStatusText('error'), "Couldn't load suggestions")
  assert.equal(mentionStatusText('ready'), 'No matches')
  assert.equal(mentionStatusText('loading'), 'Searching…')
})

test('searchMentionCandidates surfaces RPC errors', async () => {
  const orig = console.error
  console.error = () => {}
  try {
    const client = { rpc: async () => ({ data: null, error: { message: 'boom' } }) }
    const res = await searchMentionCandidates(client, { activityId: 'a', query: '' })
    assert.deepEqual(res.candidates, [])
    assert.equal(res.error.message, 'boom')
  } finally {
    console.error = orig
  }
})

test('picking a rider with a free-text nickname inserts the typeable handle', () => {
  const row = { id: 'u', nickname: 'Koen Olijslagers', display_name: 'Koen Olijslagers', handle: 'KoenOlijslagers' }
  const mention = activeMentionQuery('hi @', 4)
  const next = applyMention('hi @', mention, 4, row.handle || row.nickname)
  assert.equal(next.text, 'hi @KoenOlijslagers ')
  assert.equal(mentionHandle(row.nickname), row.handle)
})

test('popoverPlacement opens below, flips above when cramped and stays on screen', () => {
  const vp = { width: 400, height: 800 }
  const below = popoverPlacement({ left: 20, top: 100, bottom: 160, width: 300 }, vp)
  assert.equal(below.top, 164)
  assert.equal(below.bottom, undefined)
  assert.equal(below.maxHeight, 224)
  const above = popoverPlacement({ left: 20, top: 600, bottom: 660, width: 300 }, { width: 400, height: 700 })
  assert.equal(above.top, undefined)
  assert.equal(above.bottom, 104)
  const edge = popoverPlacement({ left: 380, top: 100, bottom: 160, width: 300 }, vp)
  assert.ok(edge.left + edge.width <= 392)
})

test('profileMentionHandle falls back to first+last name when the nickname is empty', () => {
  assert.equal(profileMentionHandle({ nickname: null, first_name: 'Jana', last_name: 'Kolarova' }), 'JanaKolarova')
  assert.equal(profileMentionHandle({ nickname: '  ', first_name: 'Jana', last_name: 'Kolářová' }), 'JanaKolářová')
  assert.equal(profileMentionHandle({ nickname: 'jk', first_name: 'Jana', last_name: 'Kolarova' }), 'jk')
  assert.equal(profileMentionHandle({ nickname: null, first_name: 'Jana', last_name: null }), 'Jana')
  assert.equal(profileMentionHandle({ nickname: null, first_name: null, last_name: null }), null)
})

test('mention links resolve accent- and case-insensitively', () => {
  assert.equal(foldHandle('JanaKolářová'), foldHandle('janakolarova'))
  const parts = splitCommentBody('hey @janakolarova!', new Map([[foldHandle('JanaKolářová'), 'u9']]))
  assert.deepEqual(parts.filter((p) => p.type === 'mention'), [{ type: 'mention', text: '@janakolarova', userId: 'u9' }])
})
