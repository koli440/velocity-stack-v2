import test from 'node:test'
import assert from 'node:assert/strict'
import { acquireScrollLock } from '../scrollLockCore.js'

const el = (overflow = '') => ({ style: { overflow } })

test('locks and restores original value', () => {
  const t = el('auto')
  const release = acquireScrollLock(t)
  assert.equal(t.style.overflow, 'hidden')
  release()
  assert.equal(t.style.overflow, 'auto')
})

test('nested locks restore only when last releases, in any order', () => {
  const t = el('')
  const a = acquireScrollLock(t)
  const b = acquireScrollLock(t)
  a()
  assert.equal(t.style.overflow, 'hidden')
  b()
  assert.equal(t.style.overflow, '')
})

test('release is idempotent', () => {
  const t = el('')
  const a = acquireScrollLock(t)
  const b = acquireScrollLock(t)
  a(); a()
  assert.equal(t.style.overflow, 'hidden')
  b()
  assert.equal(t.style.overflow, '')
})

test('relock after full release captures fresh original', () => {
  const t = el('')
  acquireScrollLock(t)()
  t.style.overflow = 'scroll'
  const r = acquireScrollLock(t)
  r()
  assert.equal(t.style.overflow, 'scroll')
})

test('null target is a no-op', () => {
  assert.doesNotThrow(() => acquireScrollLock(null)())
})
