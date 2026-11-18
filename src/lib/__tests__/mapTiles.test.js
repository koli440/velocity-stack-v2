import test, { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapTiles } from '../mapTiles.js'

describe('mapTiles', () => {
  it('always uses the light style with 512px tiles, @2x on retina', () => {
    const t = mapTiles({ key: 'k', retina: true })
    assert.match(t.url, /streets-v2\/\{z\}\/\{x\}\/\{y\}@2x\.png\?key=k/)
    assert.equal(t.tileSize, 512)
    assert.equal(t.zoomOffset, -1)
    assert.doesNotMatch(mapTiles({ key: 'k' }).url, /@2x|dark/)
  })
  it('falls back to OSM without a key', () => {
    const t = mapTiles({ key: '' })
    assert.match(t.url, /tile\.openstreetmap\.org/)
    assert.equal(t.tileSize, 256)
    assert.equal(t.zoomOffset, 0)
  })
})
