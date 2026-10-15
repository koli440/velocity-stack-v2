// Run with: node --test src/lib/__tests__/wkgDsl.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseIntervalDsl, stringifyIntervalDsl, buildIntervalManifest, manifestToDslInput } from '../intervalDsl.js'
import { evaluateTemplate } from '../templateEngine.js'
import { WKG_SYSTEM_TEMPLATES, buildLtManifest } from '../systemTemplates.js'

const rep = (v, n) => new Array(n).fill(v)

test('parses W/kg range, min and max bands and round-trips', () => {
  const cases = [
    ['3-3.5W/kg', [3, 3.5]], ['>3.5W/kg', [3.5, null]], ['<2W/kg', [null, 2]], ['2.5 - 3 w/kg', [2.5, 3]],
  ]
  for (const [band, range] of cases) {
    const p = parseIntervalDsl(`1x\nwork 10min ±10% @ ${band}`)
    assert.deepEqual(p.errors, [], band)
    assert.equal(p.steps[0].bandType, 'wkg')
    assert.deepEqual([p.steps[0].powerMin, p.steps[0].powerMax], range)
    const text = stringifyIntervalDsl(p)
    const again = parseIntervalDsl(text)
    assert.deepEqual(again.errors, [])
    assert.equal(stringifyIntervalDsl(again), text)
    assert.deepEqual(again.steps, p.steps)
  }
})

test('bare W/kg target means target ±5% and normalises to a stable range', () => {
  const p = parseIntervalDsl('1x\nwork 10min ±10% @ 3W/kg')
  assert.deepEqual(p.errors, [])
  assert.deepEqual([p.steps[0].bandType, p.steps[0].powerMin, p.steps[0].powerMax], ['wkg', 2.85, 3.15])
  const text = stringifyIntervalDsl(p)
  assert.equal(text, '1x\nwork 10min ±10% @ 2.85-3.15W/kg')
  assert.equal(stringifyIntervalDsl(parseIntervalDsl(text)), text)
})

test('manifest round trip keeps W/kg bands', () => {
  const p = parseIntervalDsl('2x\nwork 5min ±10% @ 3-3.5W/kg\nrecovery 3min ±30% @ <1.5W/kg')
  const m = buildIntervalManifest(p)
  assert.equal(m.steps[0].bandType, 'wkg')
  assert.equal(stringifyIntervalDsl(manifestToDslInput(m)), '2x\nwork 5min ±10% @ 3-3.5W/kg\nrecovery 3min ±30% @ <1.5W/kg')
})

test('existing W and other bands are unaffected', () => {
  const p = parseIntervalDsl('1x\nwork 5min ±10% @ 250-300W')
  assert.equal(p.steps[0].bandType, 'watts')
})

function tpl(dsl) {
  const p = parseIntervalDsl(dsl)
  assert.deepEqual(p.errors, [])
  return { slug: 't', manifest: buildIntervalManifest(p) }
}
const streams = () => ({ watts: [...rep(100, 30), ...rep(240, 300), ...rep(100, 60), ...rep(245, 300), ...rep(100, 60)] })

test('W/kg band matches using the activity weight (240-245 W at 70 kg = 3.4-3.5 W/kg)', () => {
  const t = tpl('2x\nwork 5min ±10% @ 3.3-3.6W/kg\nrecovery 1min ±30% @ <1.6W/kg')
  const r = evaluateTemplate(t, streams(), null, null, null, 70)
  const work = r.efforts.filter((e) => e.role === 'work')
  assert.equal(work.length, 2)
  for (const e of work) {
    assert.ok(e.avg_wkg >= 3.3 && e.avg_wkg <= 3.6, String(e.avg_wkg))
    assert.equal(e.avg_wkg, Math.round((e.avg_power / 70) * 100) / 100)
  }
})

test('same ride, heavier athlete falls out of the band', () => {
  const t = tpl('2x\nwork 5min ±10% @ 3.3-3.6W/kg')
  const r = evaluateTemplate(t, streams(), null, null, null, 90)
  assert.equal(r.efforts.filter((e) => e.role === 'work').length, 0)
})

test('missing weight yields a clear reason and no efforts', () => {
  const t = tpl('2x\nwork 5min ±10% @ 3.3-3.6W/kg')
  const r = evaluateTemplate(t, streams(), 250, null, null, null)
  assert.equal(r.efforts.length, 0)
  assert.match(r.summary.reason, /body weight/)
})

test('W/kg system templates parse, round-trip and match the migration', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261107000000_wkg_templates.sql', import.meta.url), 'utf8')
  assert.match(sql, /ON CONFLICT \(slug\) DO UPDATE/)
  assert.ok(WKG_SYSTEM_TEMPLATES.length >= 2)
  for (const t of WKG_SYSTEM_TEMPLATES) {
    const p = parseIntervalDsl(t.dsl)
    assert.deepEqual(p.errors, [], t.slug)
    assert.equal(stringifyIntervalDsl(p), t.dsl)
    assert.ok(sql.includes(`$q$${t.slug}$q$`))
    assert.ok(sql.includes(`$q$${JSON.stringify(buildLtManifest(t.dsl))}$q$::jsonb`))
    assert.ok(sql.includes(`$q$${t.dsl}$q$`))
  }
})
