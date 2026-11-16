// Lab module feature registry (docs/lab.md). `ready` features have a page; the Lab index lists them in
// priority order. Routes: /coach/<riderId>/lab[/<key>] (coach, athlete context) and /lab[/<key>] (own).
export const LAB_FEATURES = Object.freeze([
  { key: 'protocols', label: 'Protocol runner', desc: 'Guided FTP and critical power field tests, pushed to the calendar.', icon: 'flask' },
  { key: 'lactate', label: 'Lactate step test', desc: 'Enter lactate, heart rate and power per step; get LT1, LT2 and OBLA thresholds.', icon: 'flask' },
  { key: 'schedule', label: 'Test scheduler', desc: 'Repeat tests every few weeks with reminders and a progress timeline.', icon: 'flask' },
  { key: 'profile', label: 'Power profile', desc: 'Sprinter, pursuiter or time trialist from the power-duration curve.', icon: 'flask' },
  { key: 'durability', label: 'Durability', desc: 'Fresh versus fatigued 5-minute power after about 2000 kJ.', icon: 'flask' },
  { key: 'decoupling', label: 'Efficiency and decoupling', desc: 'Aerobic decoupling (Pw:HR) and efficiency factor across steady rides.', icon: 'flask' },
  { key: 'forms', label: 'Field forms', desc: 'Body composition, mobility checklist and sprint test with history.', icon: 'flask' },
  { key: 'reports', label: 'Reports', desc: 'Branded, revocable share links with logo and licence badge; print to PDF.', icon: 'flask' },
])

export const labFeature = (key) => LAB_FEATURES.find((f) => f.key === key) || null

export function labBasePath(riderId) {
  return riderId ? `/coach/${riderId}/lab` : '/lab'
}
