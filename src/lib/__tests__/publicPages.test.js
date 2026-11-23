import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PUBLIC_PATHS, PRIVATE_PATHS, MAX_DESCRIPTION, MAX_TITLE, TITLE_SUFFIX } from '../seo.js'
import { isPublicContentPath } from '../publicPaths.js'
import { llmsTxt } from '../llms.js'
import { parseIntervalDsl } from '../intervalDsl.js'
import {
  COACHING_PATH, COACHING_TITLE, COACHING_DESCRIPTION, TEMPLATES_PATH, TEMPLATES_TITLE, TEMPLATES_DESCRIPTION,
  GALLERY_SLUGS, galleryTemplates, coachingJsonLd, templatesJsonLd,
} from '../publicPages.js'

const PAGES = [
  [COACHING_PATH, COACHING_TITLE, COACHING_DESCRIPTION],
  [TEMPLATES_PATH, TEMPLATES_TITLE, TEMPLATES_DESCRIPTION],
]

test('coaching and template gallery pages are public, indexable and listed', () => {
  const llms = llmsTxt([], [])
  const sitemap = fs.readFileSync('src/app/sitemap.js', 'utf8')
  for (const [p] of PAGES) {
    assert.ok(PUBLIC_PATHS.includes(p), p)
    assert.ok(isPublicContentPath(p), p)
    assert.ok(!PRIVATE_PATHS.some((x) => p.startsWith(x)), p)
    assert.ok(llms.includes(`https://velocity-stack.app${p}`), p)
    assert.ok(sitemap.includes(`'${p}'`), p)
  }
})

test('private templates area stays private', () => {
  assert.ok(PRIVATE_PATHS.includes('/templates'))
  assert.ok(!isPublicContentPath('/templates'))
})

test('titles and descriptions fit and are unique', () => {
  for (const [, t, d] of PAGES) {
    assert.ok(t.length + TITLE_SUFFIX.length <= MAX_TITLE)
    assert.ok(d.length <= MAX_DESCRIPTION)
  }
  assert.notEqual(TEMPLATES_DESCRIPTION, COACHING_DESCRIPTION)
})

test('gallery shows real, valid catalogue templates', () => {
  const list = galleryTemplates()
  assert.equal(list.length, GALLERY_SLUGS.length)
  assert.ok(list.length >= 5 && list.length <= 10)
  for (const t of list) assert.deepEqual(parseIntervalDsl(t.dsl).errors, [], t.slug)
})

test('structured data states the app is free', () => {
  for (const ld of [coachingJsonLd(), templatesJsonLd()]) {
    const app = ld['@graph'].find((n) => n['@type'] === 'WebApplication')
    assert.equal(app.offers.price, '0')
    assert.equal(app.isAccessibleForFree, true)
  }
})

test('homepage and footer link to the public pages', () => {
  const landing = fs.readFileSync('src/components/Landing.js', 'utf8')
  const footer = fs.readFileSync('src/components/Footer.js', 'utf8')
  for (const p of ['/track', '/how-it-works', '/velodromes', '/coaching', '/analysis-templates']) {
    assert.ok(landing.includes(`'${p}'`), `landing ${p}`)
    assert.ok(footer.includes(`href="${p}"`), `footer ${p}`)
  }
})
