import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canNavigate,
  nextIndex,
  prevIndex,
  positionLabel,
  adjacentIndices,
  keyAction,
  swipeAction,
} from '../lightboxNav.js'

test('wraps around at both ends', () => {
  assert.equal(nextIndex(4, 5), 0)
  assert.equal(prevIndex(0, 5), 4)
  assert.equal(nextIndex(1, 5), 2)
  assert.equal(prevIndex(3, 5), 2)
})

test('empty or single set stays at 0', () => {
  assert.equal(nextIndex(0, 0), 0)
  assert.equal(prevIndex(0, 1), 0)
  assert.equal(canNavigate(1), false)
  assert.equal(canNavigate(2), true)
})

test('position label is 1-based', () => {
  assert.equal(positionLabel(1, 5), '2 / 5')
})

test('adjacent indices are unique and exclude current', () => {
  assert.deepEqual(adjacentIndices(0, 1), [])
  assert.deepEqual(adjacentIndices(0, 2), [1])
  assert.deepEqual(adjacentIndices(0, 5), [4, 1])
})

test('key actions', () => {
  assert.equal(keyAction('ArrowLeft', 3), 'prev')
  assert.equal(keyAction('ArrowRight', 3), 'next')
  assert.equal(keyAction('Escape', 1), 'close')
  assert.equal(keyAction('ArrowRight', 1), null)
  assert.equal(keyAction('a', 3), null)
})

test('swipe actions', () => {
  assert.equal(swipeAction(-80, 5, 3), 'next')
  assert.equal(swipeAction(80, 5, 3), 'prev')
  assert.equal(swipeAction(20, 0, 3), null)
  assert.equal(swipeAction(-60, 100, 3), null)
  assert.equal(swipeAction(-80, 0, 1), null)
})
