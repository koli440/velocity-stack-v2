import test, { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldAutoScrollToToday, todayScrollBehavior } from '../calendarScroll.js'

describe('calendarScroll', () => {
  it('scrolls only when the anchor month contains today', () => {
    const today = new Date(2026, 9, 30)
    assert.equal(shouldAutoScrollToToday(new Date(2026, 9, 1), today), true)
    assert.equal(shouldAutoScrollToToday(new Date(2026, 8, 30), today), false)
    assert.equal(shouldAutoScrollToToday(new Date(2025, 9, 30), today), false)
  })
  it('uses instant scrolling for reduced motion', () => {
    assert.equal(todayScrollBehavior(true), 'auto')
    assert.equal(todayScrollBehavior(false), 'smooth')
  })
})
