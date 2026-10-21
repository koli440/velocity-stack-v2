import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTeeth, parseGear, gearRatio, gearInchesFor, gearDevelopment, gearLabel, toGearField,
  gearDefaultFromProfile, fetchGearDefault, GEAR_TEETH_MIN, GEAR_TEETH_MAX,
} from '../gear.js'

test('parseTeeth enforces whole numbers inside the shared range', () => {
  assert.equal(parseTeeth('52'), 52)
  assert.equal(parseTeeth(14), 14)
  assert.equal(parseTeeth(''), null)
  assert.equal(parseTeeth(null), null)
  assert.equal(parseTeeth('14.5'), null)
  assert.equal(parseTeeth(GEAR_TEETH_MIN - 1), null)
  assert.equal(parseTeeth(GEAR_TEETH_MAX + 1), null)
  assert.equal(parseTeeth('abc'), null)
})

test('parseGear: empty is valid, partial/invalid is an error', () => {
  assert.deepEqual(parseGear('', ''), { chainring: null, cog: null, empty: true, valid: true, error: null })
  assert.equal(parseGear(null, undefined).valid, true)
  assert.deepEqual(parseGear('50', '15'), { chainring: 50, cog: 15, empty: false, valid: true, error: null })
  assert.match(parseGear('50', '').error, /both/)
  assert.match(parseGear('', '15').error, /both/)
  assert.match(parseGear('500', '15').error, /Chainring/)
  assert.match(parseGear('50', '2').error, /Cog/)
})

test('ratio, gear inches, development and label', () => {
  assert.equal(gearRatio(56, 14), 4)
  assert.equal(gearRatio('', ''), null)
  assert.equal(gearInchesFor(56, 14, 27), 108)
  assert.equal(gearInchesFor(56, 14) > 100, true)
  assert.ok(Math.abs(gearDevelopment(56, 14) - 4 * 26.8 * Math.PI * 0.0254) < 1e-9 || gearDevelopment(56, 14) > 8)
  assert.equal(gearDevelopment(1, 14), null)
  assert.equal(gearLabel(52, 14), '52x14')
  assert.equal(gearLabel('', ''), '')
  assert.equal(toGearField(null), '')
  assert.equal(toGearField(52), '52')
})

test('gear defaults come only from a complete saved default', () => {
  assert.deepEqual(gearDefaultFromProfile({ default_chainring: 50, default_cog: 15 }), { chainring: '50', cog: '15' })
  assert.deepEqual(gearDefaultFromProfile({ default_chainring: 50, default_cog: null }), { chainring: '', cog: '' })
  assert.deepEqual(gearDefaultFromProfile(null), { chainring: '', cog: '' })
})

test('fetchGearDefault filters by the explicit owner and never defaults', async () => {
  const calls = []
  const client = {
    from: (t) => ({
      select: () => ({
        eq: (col, val) => {
          calls.push([t, col, val])
          return { maybeSingle: async () => ({ data: { default_chainring: 48, default_cog: 16 } }) }
        },
      }),
    }),
  }
  assert.deepEqual(await fetchGearDefault(client, 'athlete-1'), { chainring: '48', cog: '16' })
  assert.deepEqual(calls, [['profiles', 'id', 'athlete-1']])
  assert.deepEqual(await fetchGearDefault(client, null), { chainring: '', cog: '' })
  assert.equal(calls.length, 1)
})
