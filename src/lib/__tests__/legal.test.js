import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLegalDoc, slugifyHeading, formatLegalDate, LEGAL_SLUGS } from '../legal.js'
import { loadLegal } from '../server/legalContent.js'

const doc = (body, extra = '') => `---\ntitle: T\ndescription: D\nupdated: 2027-01-10\n${extra}---\n${body}\n`

test('slugifyHeading', () => {
  assert.equal(slugifyHeading('1. Who we are & contact'), '1-who-we-are-contact')
})

test('formatLegalDate', () => {
  assert.equal(formatLegalDate('2027-01-10'), '10 January 2027')
})

test('parseLegalDoc builds ids and a toc from ## headings only', () => {
  const d = parseLegalDoc(doc('## One\n\ntext\n\n### Sub\n\n## Two\n\n- a'), 'x')
  assert.deepEqual(d.toc, [{ id: 'one', text: 'One' }, { id: 'two', text: 'Two' }])
  assert.equal(d.blocks.find((b) => b.level === 3).id, 'sub')
  assert.equal(d.updated, '2027-01-10')
})

test('parseLegalDoc rejects bad input', () => {
  assert.throws(() => parseLegalDoc(doc('## A\n\n## A'), 'x'), /duplicate/)
  assert.throws(() => parseLegalDoc(doc('just text'), 'x'), /heading/)
  assert.throws(() => parseLegalDoc('---\ntitle: T\ndescription: D\nupdated: 2027-13-40\n---\n## A', 'x'), /updated/)
  assert.throws(() => parseLegalDoc('---\ndescription: D\nupdated: 2027-01-10\n---\n## A', 'x'), /title/)
})

test('the shipped legal documents load', () => {
  for (const slug of LEGAL_SLUGS) {
    const d = loadLegal(slug)
    assert.ok(d.toc.length >= 8, slug)
  }
  assert.throws(() => loadLegal('nope'))
})
