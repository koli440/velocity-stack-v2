import test, { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapStyleFor, mapTilesFor } from '../mapTiles.js'

describe('mapTiles', () => {
  it('picks a light style unless the theme is dark', () => {
    assert.equal(mapStyleFor('dark'), 'dataviz-dark')
    assert.equal(mapStyleFor('light'), 'streets-v2')
    assert.equal(mapStyleFor(undefined), 'streets-v2')
  })
  it('uses 512px tiles and @2x on retina', () => {
    const t = mapTilesFor('light', { key: 'k', retina: true })
    assert.match(t.url, /streets-v2\/\{z\}\/\{x\}\/\{y\}@2x\.png\?key=k/)
    assert.equal(t.tileSize, 512)
    assert.equal(t.zoomOffset, -1)
    assert.doesNotMatch(mapTilesFor('dark', { key: 'k' }).url, /@2x/)
  })
  it('falls back to OSM without a key', () => {
    const t = mapTilesFor('dark', { key: '' })
    assert.match(t.url, /tile\.openstreetmap\.org/)
    assert.equal(t.tileSize, undefined)
  })
})
