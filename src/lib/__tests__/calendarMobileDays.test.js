import test, { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hasDayContent, isShownOnMobile, isEmptyDay } from '../calendarMobileDays'

const cell = (o = {}) => ({ events: [], notes: [], races: [], inMonth: true, isToday: false, ...o })

describe('calendarMobileDays', () => {
  it('shows empty in-month days', () => {
    assert.equal(isShownOnMobile(cell()), true)
    assert.equal(isEmptyDay(cell()), true)
  })
  it('hides empty padding days from other months', () => {
    assert.equal(isShownOnMobile(cell({ inMonth: false })), false)
  })
  it('shows padding days with content or today', () => {
    assert.equal(isShownOnMobile(cell({ inMonth: false, notes: [{}] })), true)
    assert.equal(isShownOnMobile(cell({ inMonth: false, isToday: true })), true)
  })
  it('detects content', () => {
    assert.equal(hasDayContent(cell({ races: [{}] })), true)
    assert.equal(hasDayContent(cell({ events: [{}] })), true)
  })
})
