import test from 'node:test'
import assert from 'node:assert/strict'
import { blogEventParams, trackBlogEvent, readDepthReached } from './blogTracking.js'
import { blogPostRows } from './adminDashboard.js'

test('params carry only event and slug and reject invalid input', () => {
  assert.deepEqual(blogEventParams('blog_view', 'my-post'), { p_event: 'blog_view', p_slug: 'my-post' })
  assert.equal(blogEventParams('other', 'my-post'), null)
  assert.equal(blogEventParams('blog_view', 'Bad Slug'), null)
  assert.equal(blogEventParams('blog_view', 'a'.repeat(81)), null)
  assert.equal(blogEventParams('blog_view', undefined), null)
})

test('tracking is fire-and-forget and never throws', () => {
  const calls = []
  assert.equal(trackBlogEvent({ rpc: (n, p) => { calls.push([n, p]); return Promise.reject(new Error('x')) } }, 'blog_read_75', 'a-b'), true)
  assert.deepEqual(calls[0], ['track_blog_event', { p_event: 'blog_read_75', p_slug: 'a-b' }])
  assert.equal(trackBlogEvent({ rpc: () => { throw new Error('boom') } }, 'blog_view', 'a'), true)
  assert.equal(trackBlogEvent(null, 'blog_view', 'a'), false)
  assert.equal(trackBlogEvent({ rpc: () => {} }, 'blog_view', 'BAD'), false)
})

test('read depth is reached when the viewport bottom passes 75% of the article', () => {
  assert.equal(readDepthReached({ top: 0, height: 1000 }, 700), false)
  assert.equal(readDepthReached({ top: -100, height: 1000 }, 700), true)
  assert.equal(readDepthReached({ top: 0, height: 0 }, 700), false)
})

test('blog rows include posts without events, sorted by views, with rates', () => {
  const stats = { posts: [
    { slug: 'a', views_30d: 5, views: 10, impressions: 20, clicks: 5, read_75: 4 },
    { slug: 'junk', views: 99 },
  ] }
  const rows = blogPostRows(stats, [{ slug: 'z', title: 'Zero' }, { slug: 'a', title: 'A' }])
  assert.deepEqual(rows.map((r) => r.slug), ['a', 'z'])
  assert.equal(rows[0].ctr, 25)
  assert.equal(rows[0].readRate, 40)
  assert.equal(rows[1].views, 0)
  assert.equal(rows[1].ctr, 0)
})
