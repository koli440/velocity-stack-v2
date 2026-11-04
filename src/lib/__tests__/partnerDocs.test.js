import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePartnerDocs } from '../partnerDocs.js'
import { loadPartnerDocs } from '../server/partnerDocsContent.js'

test('docs/partner-api.md renders with title, toc and spec link', () => {
  const d = loadPartnerDocs()
  assert.equal(d.title, 'Partner API (OAuth 2.0)')
  assert.ok(d.toc.length >= 3)
  const ids = d.blocks.filter((b) => b.type === 'h').map((b) => b.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(JSON.stringify(d.blocks).includes('/openapi/v1.yaml'))
})

test('duplicate headings get unique ids', () => {
  const d = parsePartnerDocs('# T\n\n## A\n\nx\n\n## A\n')
  assert.deepEqual(d.blocks.filter((b) => b.type === 'h').map((b) => b.id), ['a', 'a-x'])
})
