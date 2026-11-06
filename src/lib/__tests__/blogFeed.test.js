import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeBlogCards, cardTime, withOwnAuthorAvatar } from '../blogFeed.js'

const act = (id, date) => ({ id, activity_date: date })
const card = (slug, date) => ({ slug, date })
const seq = (rows) => rows.map((r) => (r.kind === 'blog' ? `blog:${r.card.slug}` : r.activity.id))
const NOW = new Date('2026-11-06T18:00:00Z')

test('a card sits chronologically among activities', () => {
  const acts = [act('a1', '2026-11-05T10:00:00Z'), act('a2', '2026-10-20T10:00:00Z'), act('a3', '2026-10-01T10:00:00Z')]
  const rows = mergeBlogCards(acts, [card('p', '2026-10-25')], { hasMore: false, now: NOW })
  assert.deepEqual(seq(rows), ['a1', 'blog:p', 'a2', 'a3'])
})

test('newer than all activities: first; older than all: last when nothing more to load', () => {
  const acts = [act('a1', '2026-10-20T10:00:00Z')]
  assert.deepEqual(seq(mergeBlogCards(acts, [card('new', '2026-11-01'), card('old', '2026-01-01')], { now: NOW })), ['blog:new', 'a1', 'blog:old'])
})

test('with more pages, older cards wait until the feed reaches them', () => {
  const page1 = [act('a1', '2026-11-05T10:00:00Z'), act('a2', '2026-10-20T10:00:00Z')]
  const cards = [card('mid', '2026-10-25'), card('old', '2026-09-01')]
  assert.deepEqual(seq(mergeBlogCards(page1, cards, { hasMore: true, now: NOW })), ['a1', 'blog:mid', 'a2'])
  const page2 = [...page1, act('a3', '2026-09-10T10:00:00Z'), act('a4', '2026-08-30T10:00:00Z')]
  assert.deepEqual(seq(mergeBlogCards(page2, cards, { hasMore: true, now: NOW })), ['a1', 'blog:mid', 'a2', 'a3', 'blog:old', 'a4'])
  // Loading more never reorders what was already shown.
  const before = seq(mergeBlogCards(page1, cards, { hasMore: true, now: NOW }))
  assert.deepEqual(seq(mergeBlogCards(page2, cards, { hasMore: true, now: NOW })).slice(0, before.length), before)
})

test('riders without activities see every published card, newest first', () => {
  const rows = mergeBlogCards([], [card('a', '2026-01-01'), card('b', '2026-05-01')], { hasMore: false, now: NOW })
  assert.deepEqual(seq(rows), ['blog:b', 'blog:a'])
  assert.deepEqual(seq(mergeBlogCards([], [card('a', '2026-01-01')], { hasMore: true, now: NOW })), ['blog:a'])
})

test('future-dated posts never show', () => {
  const rows = mergeBlogCards([], [card('future', '2026-11-07'), card('today', '2026-11-06')], { now: NOW })
  assert.deepEqual(seq(rows), ['blog:today'])
  assert.deepEqual(seq(mergeBlogCards([], [card('future', '2026-11-07')], { now: new Date('2026-11-07T11:59:00Z') })), [])
  assert.deepEqual(seq(mergeBlogCards([], [card('future', '2026-11-07')], { now: new Date('2026-11-07T12:00:00Z') })), ['blog:future'])
})

test('activities are untouched: same objects, same order, no cards without data', () => {
  const acts = [act('a1', '2026-11-05T10:00:00Z'), act('a2', '2026-10-20T10:00:00Z')]
  const rows = mergeBlogCards(acts, [card('p', '2026-10-25')], { now: NOW })
  assert.deepEqual(rows.filter((r) => r.kind === 'activity').map((r) => r.activity), acts)
  assert.deepEqual(seq(mergeBlogCards(acts, null, { now: NOW })), ['a1', 'a2'])
  assert.deepEqual(seq(mergeBlogCards(acts, [], { now: NOW })), ['a1', 'a2'])
  assert.deepEqual(seq(mergeBlogCards(null, undefined, { now: NOW })), [])
})

test('ties: a card goes after activities of the same instant, bad dates are ignored', () => {
  const t = new Date(cardTime(card('x', '2026-10-25'))).toISOString()
  assert.deepEqual(seq(mergeBlogCards([act('a1', t)], [card('x', '2026-10-25')], { now: NOW })), ['a1', 'blog:x'])
  assert.deepEqual(seq(mergeBlogCards([act('a1', t)], [card('bad', 'nope')], { now: NOW })), ['a1'])
})

test('cards carry no rider data', () => {
  const rows = mergeBlogCards([], [card('p', '2026-10-25')], { now: NOW })
  assert.deepEqual(Object.keys(rows[0]).sort(), ['card', 'kind'])
})

test('own avatar fills a missing author avatar only for the author', () => {
  const cards = [{ slug: 'a', avatarUrl: null }, { slug: 'b', avatarUrl: '/x.webp' }]
  const mine = { nickname: 'Koli440', avatar_url: 'https://s/avatars/me.webp' }
  assert.deepEqual(withOwnAuthorAvatar(cards, mine, 'koli440').map((c) => c.avatarUrl), ['https://s/avatars/me.webp', '/x.webp'])
  assert.equal(withOwnAuthorAvatar(cards, { nickname: 'other', avatar_url: 'https://s/o.webp' }, 'koli440'), cards)
  assert.equal(withOwnAuthorAvatar(cards, null, 'koli440'), cards)
})
