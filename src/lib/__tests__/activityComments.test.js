import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMENT_MAX_LENGTH,
  activeMentionQuery,
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
