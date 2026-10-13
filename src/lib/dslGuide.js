// Content for the standalone DSL Syntax Guide page (/dsl-guide).
// Every example here is validated against the parser in __tests__/dslGuide.test.js.

export const DSL_GUIDE_PATH = '/dsl-guide'

export const DSL_STEP_PARTS = [
  { part: 'work | recovery', meaning: 'Step role. "work" is the effort you want analysed; "recovery" is the rest between efforts.' },
  { part: '<value><unit>', meaning: 'Length of the step. Duration units: min, sec. Distance units: km, m. Decimals are allowed (1.5min).' },
  { part: '±<n>%', meaning: 'Tolerance (0-100%) on the length when matching the step against an activity.' },
  { part: '@ <band>', meaning: 'Intensity target: a range, an upper/lower bound, or "best".' },
]

export const DSL_BANDS = [
  { syntax: '90-110%FTP', meaning: 'Range as a percentage of your FTP.' },
  { syntax: '<55%FTP', meaning: 'Upper bound only (at most 55% FTP) — typical for recoveries.' },
  { syntax: '>80%FTP', meaning: 'Lower bound only (at least 80% FTP).' },
  { syntax: '250-300W', meaning: 'Absolute watts range; works without an FTP set. Bounds (<150W, >200W) work too.' },
  { syntax: '30-40km/h', meaning: 'Speed range in km/h. Bounds (<20km/h, >45km/h) work too.' },
  { syntax: 'best  /  max', meaning: 'No threshold: find the single highest-average window of that length. On duration steps this means power.' },
  { syntax: 'best power  /  best speed', meaning: 'Required for "best"/"max" on distance steps, which have no default metric.' },
]

export const DSL_RULES = [
  'Line 1 must be the repeat count: "4x", "1x", etc. (1 or greater).',
  'Every following line is one step; at least one "work" step is required.',
  'Step values must be greater than 0; tolerance must be 0-100%.',
  'In a range, the minimum must be lower than the maximum.',
  'The tolerance sign is "±" (plus-minus).',
  '"best"/"max" on km/m steps must say "power" or "speed".',
]

export const DSL_GUIDE_EXAMPLES = [
  {
    title: 'Repeated VO2max intervals (%FTP-banded)',
    description: 'Four 3-minute efforts at 90-110% FTP, each followed by 2 minutes of easy spinning.',
    dsl: '4x\nwork 3min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP',
  },
  {
    title: 'Threshold block',
    description: 'One continuous 20-minute effort at 95-105% FTP.',
    dsl: '1x\nwork 20min ±15% @ 95-105%FTP',
  },
  {
    title: '3 x 10min sweet spot',
    description: 'Longer repeats with a lower-bound-only target, so anything above 88% FTP counts.',
    dsl: '3x\nwork 10min ±10% @ >88%FTP\nrecovery 5min ±30% @ <60%FTP',
  },
  {
    title: 'Short sprints',
    description: 'Ten 15-second sprints at or above 150% FTP with long recoveries.',
    dsl: '10x\nwork 15sec ±20% @ >150%FTP\nrecovery 3min ±50% @ <55%FTP',
  },
  {
    title: 'Decisive climb / final sprint (one-shot, no FTP needed)',
    description: 'Find the best 5-minute effort in the ride; no recovery line and no threshold.',
    dsl: '1x\nwork 5min ±40% @ best',
  },
  {
    title: 'Absolute watts (no FTP set)',
    description: 'Use watts directly when the rider has no FTP configured.',
    dsl: '5x\nwork 30sec ±20% @ 250-300W\nrecovery 90sec ±50% @ <150W',
  },
  {
    title: 'Speed-banded effort',
    description: 'Target speed instead of power, e.g. for motor-paced or track efforts.',
    dsl: '2x\nwork 2km ±10% @ 45-50km/h\nrecovery 3min ±50% @ <30km/h',
  },
  {
    title: 'Pursuit pacing: best power over 4 x 1km',
    description: 'Distance-keyed steps need an explicit metric after "best".',
    dsl: '4x\nwork 1km ±5% @ best power\nrecovery 2min ±50% @ <55%FTP',
  },
  {
    title: 'Flying 200: best speed over a single 200m',
    description: 'One-shot distance step looking for the fastest 200m.',
    dsl: '1x\nwork 200m ±10% @ best speed',
  },
]

export const DSL_COMMON_MISTAKES = [
  {
    dsl: 'work 3min ±30% @ 90-110%FTP',
    fix: 'Missing the repeat line. Start with "1x" or "4x".',
  },
  {
    dsl: '1x\nwork 1km ±5% @ best',
    fix: 'Distance steps need a metric: "best power" or "best speed".',
  },
  {
    dsl: '1x\nwork 3min +-30% @ 90-110%FTP',
    fix: 'Use the single "±" character, not "+-".',
  },
  {
    dsl: '1x\nwork 3min ±30% @ 110-90%FTP',
    fix: 'The minimum must be lower than the maximum.',
  },
]
