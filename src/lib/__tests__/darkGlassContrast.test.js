import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8')

test('dark glass cards override light-mode slate-600/700 text tint', () => {
  const rule = css.match(/html\.dark\[data-glass="on"\] :is\(\.glass-card[^{]*\) :is\(([^)]*\.text-slate-700[^)]*)\) \{\s*color: ([^;]+);/)
  assert.ok(rule, 'dark rule covering .text-slate-700 exists')
  assert.match(rule[1], /\.text-slate-600/)
  assert.equal(rule[2], '#e2e8f0')
})
