import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ICON_SET } from '../iconSet.js'
import {
  REACTION_ICON,
  fetchReactionInfo,
  reactionButtonLabel,
  reactionCountLabel,
  reactionErrorMessage,
  reactionNotificationText,
  reactorSummary,
  setActivityReaction,
  toggledState,
} from '../activityReactions.js'
import { describeNotification, notificationHref } from '../notifications.js'

test('reaction icon comes from the existing icon set', () => {
  assert.ok(ICON_SET[REACTION_ICON])
})

test('labels and optimistic toggle', () => {
  assert.equal(reactionCountLabel(3), 'Respect: 3')
  assert.equal(reactionButtonLabel(true), 'Remove your respect')
  assert.equal(reactionButtonLabel(false), 'Give respect')
  assert.deepEqual(toggledState({ count: 2, reacted: false }), { count: 3, reacted: true })
  assert.deepEqual(toggledState({ count: 0, reacted: true }), { count: 0, reacted: false })
})

test('error messages', () => {
  assert.match(reactionErrorMessage({ message: 'limit reached' }), /too fast/)
  assert.match(reactionErrorMessage({ message: 'You cannot react to your own activity' }), /own activity/)
  assert.match(reactionErrorMessage({ message: 'Reactions are turned off for this activity' }), /turned reactions off/)
  assert.match(reactionErrorMessage({ message: 'boom' }), /Something went wrong/)
})

test('reactor summary and notification text coalesce', () => {
  assert.equal(reactorSummary(['ann'], 1), 'ann')
  assert.equal(reactorSummary(['ann', 'bob'], 2), 'ann and bob')
  assert.equal(reactorSummary(['a', 'b', 'c', 'd'], 5), 'a, b, c and 2 others')
  assert.equal(reactorSummary([], 4), '4 riders')
  assert.equal(reactorSummary([], 0), '')
  assert.equal(reactionNotificationText('ann', 1), 'ann gave respect to your activity')
  assert.equal(reactionNotificationText('ann', 2), 'ann and 1 other gave respect to your activity')
  assert.equal(reactionNotificationText('ann', 4), 'ann and 3 others gave respect to your activity')
})

test('notification text and link', () => {
  assert.equal(describeNotification({ type: 'activity_reaction', event_count: 3 }, { display_name: 'ann' }), 'ann and 2 others gave respect to your activity')
  assert.equal(notificationHref({ type: 'activity_reaction', activity_id: 'a1', activity_info: { owner_id: 'u' } }), '/activities/a1')
  assert.equal(notificationHref({ type: 'activity_reaction', activity_id: 'a1' }), null)
})

test('RPC wrappers', async () => {
  const calls = []
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args])
      return name === 'activity_reaction_info'
        ? { data: [{ activity_id: 'a', reaction_count: 2 }], error: null }
        : { data: 4, error: null }
    },
  }
  const { info } = await fetchReactionInfo(client, ['a', 'a', null])
  assert.equal(info.get('a').reaction_count, 2)
  assert.deepEqual(calls[0][1].p_ids, ['a'])
  assert.equal((await fetchReactionInfo(client, [])).info.size, 0)
  const r = await setActivityReaction(client, { activityId: 'a', on: true })
  assert.equal(r.count, 4)
  assert.deepEqual(calls[1], ['set_activity_reaction', { p_activity: 'a', p_on: true, p_type: 'respect' }])
})
