import test from 'node:test'
import assert from 'node:assert/strict'
import { redditPixelSnippet, trackRedditEvent } from '../redditPixel.js'

test('snippet inits with the quoted id and tracks PageVisit', () => {
  const s = redditPixelSnippet('a2_abc"x')
  assert.ok(s.includes(`rdt('init',"a2_abc\\"x")`))
  assert.ok(s.includes(`rdt('track','PageVisit')`))
})

test('trackRedditEvent is a no-op without the pixel', () => {
  assert.doesNotThrow(() => trackRedditEvent('SignUp'))
})
