import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { confirmPhrase, endCoachingCopy, endConfirmed } from '../endCoaching.js'

const read = (p) => readFileSync(new URL(`../../components/${p}`, import.meta.url), 'utf8')

test('copy explains deletion, what is kept and what is lost for both sides', () => {
  for (const role of ['coach', 'athlete']) {
    const c = endCoachingCopy(role, 'Pepa Novak')
    assert.ok(c.deletes.join(' ').includes('30 days'))
    assert.ok(c.keeps.join(' ').toLowerCase().includes('read-only'))
    assert.ok(c.loses.length > 0 && c.title.includes('Pepa Novak'))
  }
  assert.match(endCoachingCopy('coach', 'A').loses.join(' '), /export/)
})

test('confirmation needs the typed name (case-insensitive), a fallback phrase without a name', () => {
  assert.equal(endConfirmed('', 'Pepa Novak'), false)
  assert.equal(endConfirmed('pepa', 'Pepa Novak'), false)
  assert.equal(endConfirmed(' pepa novak ', 'Pepa Novak'), true)
  assert.equal(confirmPhrase(''), 'END')
  assert.equal(endConfirmed('end', null), true)
})

test('active relationships are only ended through the dialog; one-click remains for pending cancels', () => {
  const panel = read('CoachingPanel.js')
  const buttons = read('CoachingButtons.js')
  assert.match(panel, /setEnding\(\{ id: row\.id, role: 'coach'/)
  assert.match(panel, /setEnding\(\{ id: g\.coach\.id, role: 'athlete'/)
  assert.match(buttons, /onClick=\{\(\) => setEnding\(true\)\}/)
  const direct = (src) => src.split('\n').filter((l) => l.includes('onClick') && l.includes('endCoaching(supabase'))
  // the remaining direct calls are Cancel request / Cancel invite / pending Cancel (no data is removed)
  for (const src of [panel, buttons]) {
    for (const l of direct(src)) {
      const next = src.split('\n')[src.split('\n').indexOf(l) + 1]
      assert.match(next, /Cancel/, l)
    }
  }
})
