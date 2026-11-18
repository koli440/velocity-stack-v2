// Lab module feature registry (docs/lab.md). `ready` features have a page; the Lab index lists them in
// priority order. Routes: /coach/<riderId>/lab[/<key>] (coach, athlete context) and /lab[/<key>] (own).
export const LAB_FEATURES = Object.freeze([
  { key: 'protocols', section: 'Tests', label: 'Protocol runner', desc: 'Guided FTP and critical power field tests, pushed to the calendar.', icon: 'flask' },
  { key: 'lactate', section: 'Tests', label: 'Lactate step test', desc: 'Enter lactate, heart rate and power per step; get LT1, LT2 and OBLA thresholds.', icon: 'flask' },
  { key: 'schedule', section: 'Tests', label: 'Test scheduler', desc: 'Repeat tests every few weeks with reminders and a progress timeline.', icon: 'flask' },
  { key: 'profile', section: 'Analysis', label: 'Power profile', desc: 'Sprinter, pursuiter or time trialist from the power-duration curve.', icon: 'flask' },
  { key: 'durability', section: 'Analysis', label: 'Durability', desc: 'Fresh versus fatigued 5-minute power after about 2000 kJ.', icon: 'flask' },
  { key: 'decoupling', section: 'Analysis', label: 'Efficiency and decoupling', desc: 'Aerobic decoupling (Pw:HR) and efficiency factor across steady rides.', icon: 'flask' },
  { key: 'forms', section: 'Data', label: 'Field forms', desc: 'Body composition, mobility checklist and sprint test with history.', icon: 'flask' },
  { key: 'fueling', section: 'Data', label: 'Fueling and glucose', desc: 'Glucose before, during and after rides against carbs per hour and power; fasted vs fed. Not medical advice.', icon: 'flask' },
  { key: 'fit', section: 'Data', label: 'Bike-fit log', desc: 'Dated saddle, reach, cleat and crank changes compared with power and comfort.', icon: 'flask' },
  { key: 'pedalling', section: 'Analysis', label: 'Pedalling efficiency', desc: 'Left/right balance, torque effectiveness and smoothness trended across rides.', icon: 'flask' },
  { key: 'cadence', section: 'Analysis', label: 'Cadence and torque profile', desc: 'Power at set cadences to find your most effective rpm.', icon: 'flask' },
  { key: 'reports', section: 'Data', label: 'Reports', desc: 'Branded, revocable share links with logo and licence badge; print to PDF.', icon: 'flask' },
])

export const labFeature = (key) => LAB_FEATURES.find((f) => f.key === key) || null

export function labBasePath(riderId) {
  return riderId ? `/coach/${riderId}/lab` : '/lab'
}

// Section labels of the Lab menus (athlete context and /lab); a feature without a `section` goes under "Other".
export const LAB_SECTIONS = Object.freeze(['Tests', 'Analysis', 'Data'])
export const LAB_OTHER_SECTION = 'Other'

/** Features grouped by section in menu order: [{ label, features }] (empty sections are left out, "Other" last). */
export function labSections(features = LAB_FEATURES) {
  const named = [...LAB_SECTIONS, LAB_OTHER_SECTION]
  const of = (f) => (named.includes(f.section) ? f.section : LAB_OTHER_SECTION)
  return named.map((label) => ({ label, features: features.filter((f) => of(f) === label) })).filter((s) => s.features.length)
}

/** Menu children of a Lab group: non-clickable section labels followed by their feature links. */
export function labMenuChildren(base, features = LAB_FEATURES) {
  return labSections(features).flatMap((s) => [
    { key: `lab-section-${s.label.toLowerCase()}`, type: 'label', label: s.label },
    ...s.features.map((f) => ({ key: `lab-${f.key}`, label: f.label, href: `${base}/${f.key}` })),
  ])
}
