import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fieldsFor, findExistingExercise, groupByCategory, matchScore, normalizeText, parseAliases, recentExercises,
  searchExercises, usageByCatalogue,
} from './exerciseCatalogue.js'

const CAT = [
  { id: '1', name: 'Leg press', aliases: ['legpress', 'benkpres'], category: 'Squat', movement_type: 'strength', unilateral: false, set_fields: ['reps', 'weight'] },
  { id: '2', name: 'Lunge', aliases: ['lunges', 'barbell lunges'], category: 'Lunge', movement_type: 'strength', unilateral: true, set_fields: ['reps', 'weight'] },
  { id: '3', name: 'Box jump', aliases: ['box jumps'], category: 'Jump', movement_type: 'jump', unilateral: false, set_fields: ['reps', 'height', 'weight'] },
  { id: '4', name: 'Knebøj', aliases: [], category: 'Squat', movement_type: 'strength', unilateral: false, set_fields: ['reps', 'weight'] },
]

test('normalizeText ignores case, accents, hyphens and spacing', () => {
  assert.equal(normalizeText('  Légpress  '), 'legpress')
  assert.equal(normalizeText('Step-up'), 'step up')
  assert.equal(normalizeText('Knebøj'), 'kneboj')
})

test('search finds aliases, typo-free spacing and accents', () => {
  assert.equal(searchExercises(CAT, 'leg press')[0].id, '1')
  assert.equal(searchExercises(CAT, 'legpress')[0].id, '1')
  assert.equal(searchExercises(CAT, 'kneboj')[0].id, '4')
  assert.equal(searchExercises(CAT, 'barbell lunge')[0].id, '2')
  assert.deepEqual(searchExercises(CAT, 'zzzz'), [])
})

test('exact name outranks alias match; usage breaks ties and orders the empty query', () => {
  assert.ok(matchScore(CAT[1], 'lunge') > matchScore(CAT[1], 'lunges'))
  const usage = usageByCatalogue([
    { catalogue_id: '3', created_at: '2026-11-01T00:00:00Z' },
    { catalogue_id: '3', created_at: '2026-10-01T00:00:00Z' },
    { catalogue_id: '2', created_at: '2026-11-03T00:00:00Z' },
    { catalogue_id: null, created_at: '2026-11-04T00:00:00Z' },
  ])
  assert.deepEqual(searchExercises(CAT, '', { usage }).slice(0, 2).map((e) => e.id), ['2', '3'])
  assert.deepEqual(recentExercises(CAT, usage).map((e) => e.id), ['2', '3'])
})

test('findExistingExercise catches plurals, spacing and aliases', () => {
  assert.equal(findExistingExercise(CAT, 'Lunges').id, '2')
  assert.equal(findExistingExercise(CAT, 'leg-press').id, '1')
  assert.equal(findExistingExercise(CAT, 'Something new', ['box jump']).id, '3')
  assert.equal(findExistingExercise(CAT, 'Zercher squat'), null)
})

test('fieldsFor follows the catalogue, free text gets reps and weight', () => {
  assert.deepEqual(fieldsFor(CAT[2]), ['reps', 'weight', 'height'])
  assert.deepEqual(fieldsFor({ catalogue: CAT[2] }), ['reps', 'weight', 'height'])
  assert.deepEqual(fieldsFor({ name: 'free' }), ['reps', 'weight'])
})

test('parseAliases and groupByCategory', () => {
  assert.deepEqual(parseAliases('a, b;  A ,, c'), ['a', 'b', 'c'])
  assert.deepEqual(groupByCategory(CAT).map((g) => g.category), ['Squat', 'Lunge', 'Jump'])
})
