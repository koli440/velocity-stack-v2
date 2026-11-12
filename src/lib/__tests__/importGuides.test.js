import test from 'node:test'
import assert from 'node:assert/strict'
import { IMPORT_GUIDES, IMPORT_PATHS, isImportPath, guideBySlug, guideTitle, guideDescription, faqJsonLd, howToJsonLd, importEventParams } from '../importGuides.js'
import { trackImportEvent } from '../importTracking.js'
import { buildConsentRecord, CONSENT_KEY } from '../consent.js'
import { PUBLIC_PATHS, MAX_TITLE, TITLE_SUFFIX, MAX_DESCRIPTION } from '../seo.js'
import { rideSourceById } from '../rideSources.js'
import { llmsTxt } from '../llms.js'
import { FIRST_RUN_STEPS, IMPORT_GUIDE_LINKS } from '../emptyFeed.js'
import { loadPublishedPosts } from '../server/blogContent.js'

const store = (rec) => ({ getItem: (k) => (k === CONSENT_KEY && rec ? JSON.stringify(rec) : null) })

test('every import path is public and guides map to known sources', () => {
  for (const p of IMPORT_PATHS) assert.ok(PUBLIC_PATHS.includes(p), p)
  for (const g of IMPORT_GUIDES) assert.ok(!g.sourceId || rideSourceById(g.sourceId), g.slug)
  assert.ok(isImportPath('/import') && isImportPath('/import/strava') && !isImportPath('/import-help'))
})

test('titles and descriptions fit the SEO limits', () => {
  for (const g of IMPORT_GUIDES) {
    assert.ok(guideTitle(g).length + TITLE_SUFFIX.length <= MAX_TITLE, g.slug)
    assert.ok(guideDescription(g).length <= MAX_DESCRIPTION, g.slug)
    assert.ok(g.faq.length >= 3)
  }
})

test('strava guide covers the data-export ZIP fallback and API cap', () => {
  const g = guideBySlug('strava')
  const text = JSON.stringify(g)
  assert.match(text, /ZIP/)
  assert.match(text, /limits how much its API/)
})

test('structured data is valid', () => {
  const g = guideBySlug('strava')
  const faq = faqJsonLd(g.faq)
  assert.equal(faq['@type'], 'FAQPage')
  assert.equal(faq.mainEntity.length, g.faq.length)
  assert.equal(howToJsonLd(g).step.length, g.sections.flatMap((s) => s.steps).length)
})

test('analytics fire only with analytics consent', () => {
  const sent = []
  const gtag = (...a) => sent.push(a)
  assert.equal(trackImportEvent('import_guide_view', 'strava', undefined, { storage: store(null), gtag }), false)
  assert.equal(trackImportEvent('import_guide_view', 'strava', undefined, { storage: store(buildConsentRecord({ analytics: false, marketing: true })), gtag }), false)
  assert.equal(sent.length, 0)
  const ok = store(buildConsentRecord({ analytics: true }))
  assert.equal(trackImportEvent('import_cta_click', 'fit', 'hero-register', { storage: ok, gtag }), true)
  assert.deepEqual(sent, [['event', 'import_cta_click', { source_guide: 'fit', cta: 'hero-register' }]])
  assert.equal(trackImportEvent('import_guide_view', 'strava', undefined, { storage: ok, gtag: null }), false)
  assert.equal(importEventParams('bogus', 'fit'), null)
  assert.equal(importEventParams('import_guide_view', 'nope'), null)
})

test('llms.txt lists the import pages and blog posts exist', () => {
  const txt = llmsTxt()
  for (const p of IMPORT_PATHS) assert.ok(txt.includes(`https://velocity-stack.app${p}`), p)
  const slugs = loadPublishedPosts().map((p) => p.slug)
  for (const s of ['export-strava-data', 'link-fitbit-to-strava', 'strava-alternative']) assert.ok(slugs.includes(s), s)
})

test('first-run card shows the path and links to every guide', () => {
  assert.deepEqual(FIRST_RUN_STEPS.map((s) => s.id), ['source', 'rides', 'fitness'])
  for (const g of IMPORT_GUIDES) assert.ok(IMPORT_GUIDE_LINKS.some((l) => l.href === `/import/${g.slug}`), g.slug)
})
