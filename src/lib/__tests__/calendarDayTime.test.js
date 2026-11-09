import test, { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dayCompletedDurationS, dayTimeLabel } from '../calendarDayTime.js'

describe('calendarDayTime', () => {
  it('sums completed activities only', () => {
    const ev = [{ kind: 'activity', durationS: 3600 }, { kind: 'activity', durationS: 1500 }, { kind: 'planned', durationS: 9000 }]
    assert.equal(dayCompletedDurationS(ev), 5100)
    assert.equal(dayTimeLabel(ev), '1:25')
  })
  it('ignores missing durations and hides empty days', () => {
    assert.equal(dayTimeLabel([{ kind: 'activity' }, { kind: 'planned', durationS: 600 }]), null)
    assert.equal(dayTimeLabel([]), null)
    assert.equal(dayTimeLabel(undefined), null)
  })
})
