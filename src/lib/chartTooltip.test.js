import test from 'node:test'
import assert from 'node:assert/strict'
import { formatTooltipRows } from './chartTooltip.js'

test('skips null values and uses item colour', () => {
  const rows = formatTooltipRows([
    { name: 'A', value: 5, color: '#f00' },
    { name: 'B', value: null, color: '#0f0' },
  ])
  assert.deepEqual(rows, [{ name: 'A', value: '5', color: '#f00' }])
})

test('applies formatter returning string or [value, name]', () => {
  const p = [{ name: 'A', value: 1.5, color: '#f00' }]
  assert.equal(formatTooltipRows(p, (v) => `${v.toFixed(3)} m²`)[0].value, '1.500 m²')
  const r = formatTooltipRows(p, (v, n) => [`${v}!`, `${n}x`])[0]
  assert.equal(r.value, '1.5!')
  assert.equal(r.name, 'Ax')
})

test('handles missing payload', () => {
  assert.deepEqual(formatTooltipRows(undefined), [])
})
