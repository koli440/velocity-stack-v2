// Lab module feature registry (docs/lab.md). `ready` features have a page; the Lab index lists them in
// priority order. Routes: /coach/<riderId>/lab[/<key>] (coach, athlete context) and /lab[/<key>] (own).
export const LAB_FEATURES = Object.freeze([
  { key: 'protocols', label: 'Protocol runner', desc: 'Guided FTP and critical power field tests, pushed to the calendar.', icon: 'flask' },
  { key: 'lactate', label: 'Lactate step test', desc: 'Enter lactate, heart rate and power per step; get LT1, LT2 and OBLA thresholds.', icon: 'flask' },
  { key: 'schedule', label: 'Test scheduler', desc: 'Repeat tests every few weeks with reminders and a progress timeline.', icon: 'flask' },
  { key: 'profile', label: 'Power profile', desc: 'Sprinter, pursuiter or time trialist from the power-duration curve.', icon: 'flask' },
])

export const labFeature = (key) => LAB_FEATURES.find((f) => f.key === key) || null

export function labBasePath(riderId) {
  return riderId ? `/coach/${riderId}/lab` : '/lab'
}
