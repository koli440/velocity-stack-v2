// Lab module feature registry (docs/lab.md). `ready` features have a page; the Lab index lists them in
// priority order. Routes: /coach/<riderId>/lab[/<key>] (coach, athlete context) and /lab[/<key>] (own).
export const LAB_FEATURES = Object.freeze([
  { key: 'protocols', label: 'Protocol runner', desc: 'Guided FTP and critical power field tests, pushed to the calendar.', icon: 'flask' },
])

export const labFeature = (key) => LAB_FEATURES.find((f) => f.key === key) || null

export function labBasePath(riderId) {
  return riderId ? `/coach/${riderId}/lab` : '/lab'
}
