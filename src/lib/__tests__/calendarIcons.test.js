// Run with: node --test src/lib/__tests__/calendarIcons.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ICON_SET } from '../iconSet.js'
import { PLANNED_STATUS_ICONS, PUSH_STATE_ICONS, CALENDAR_ICONS } from '../calendarIcons.js'
import { PLANNED_STATUS_LABELS } from '../plannedWorkouts.js'

test('every calendar icon exists in the unified set', () => {
  for (const map of [PLANNED_STATUS_ICONS, PUSH_STATE_ICONS, CALENDAR_ICONS]) {
    for (const name of Object.values(map)) assert.ok(ICON_SET[name], name)
  }
})

test('every planned status has an icon', () => {
  for (const status of Object.keys(PLANNED_STATUS_LABELS)) assert.ok(PLANNED_STATUS_ICONS[status], status)
})
