import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RESPECT_LEVELS, respectLevel } from '../respectLevel.js'

test('no level without respect', () => {
  for (const v of [0, -1, null, undefined, NaN, 'x']) assert.equal(respectLevel(v), null)
})

test('thresholds map to words', () => {
  const cases = [[1, 'Nod'], [2, 'Nod'], [3, 'Props'], [4, 'Props'], [5, 'Solid'], [9, 'Solid'], [10, 'Strong'],
    [24, 'Strong'], [25, 'Beast'], [50, 'Machine'], [100, 'Legend'], [249, 'Legend'], [250, 'Mythic'],
    [500, 'Immortal'], [999, 'Immortal'], [1000, 'Godlike'], [99999, 'Godlike']]
  for (const [n, w] of cases) assert.equal(respectLevel(n), w, String(n))
})

test('ten is not the top and levels ascend', () => {
  assert.ok(RESPECT_LEVELS.length >= 10)
  assert.notEqual(respectLevel(10), RESPECT_LEVELS.at(-1).word)
  for (let i = 1; i < RESPECT_LEVELS.length; i++) assert.ok(RESPECT_LEVELS[i].min > RESPECT_LEVELS[i - 1].min)
})
