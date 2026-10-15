// Content for the standalone DSL Syntax Guide page (/dsl-guide).
// Every example here is validated against the parser in __tests__/dslGuide.test.js.

export const DSL_GUIDE_PATH = '/dsl-guide'

export const DSL_STEP_PARTS = [
  { part: 'work | recovery', meaning: 'Step role. "work" is the effort you want analysed; "recovery" is the rest between efforts.' },
  { part: '<value><unit>', meaning: 'Length of the step. Duration units: min, sec. Distance units: km, m. Decimals are allowed (1.5min).' },
  { part: '±<n>%', meaning: 'Tolerance (0-100%) on the length when matching the step against an activity.' },
  { part: '@ <band>', meaning: 'Intensity target (power, speed, heart rate or cadence): a range, an upper/lower bound, or "best".' },
]

export const DSL_OPTIONS = [
  { syntax: '3 sets of 5x', meaning: 'First line: 3 sets, each with 5 repeats of the block. Reps are numbered within each set.' },
  { syntax: 'set recovery 5min ±30% @ <55%FTP', meaning: 'Optional, only with sets: the rest searched for between sets (never after the last one). Same syntax as a step, but without then.' },
  { syntax: 'then work 1min ...', meaning: 'Prefix a step with "then" to make it start exactly where the previous step ended (over-unders, pyramids, ramps). Not allowed on the first step.' },
  { syntax: 'warmup 15min', meaning: 'Ignore the first 15 minutes of the activity (min or sec). At most once.' },
  { syntax: 'metrics np, vi, hr_recovery(30sec), decoupling', meaning: 'Choose extra summary metrics per work effort and for the run: avg_power, max_power, np, vi, if, avg_hr, max_hr, avg_cadence, max_cadence, avg_speed, max_speed, work_kj, pacing, dropoff, decoupling, hr_recovery (optional window, default 60sec). At most once.' },
  { syntax: 'cooldown 10min', meaning: 'Ignore the last 10 minutes of the activity. At most once.' },
]

export const DSL_BANDS = [
  { syntax: '90-110%FTP', meaning: 'Range as a percentage of your FTP.' },
  { syntax: '<55%FTP', meaning: 'Upper bound only (at most 55% FTP) — typical for recoveries.' },
  { syntax: '>80%FTP', meaning: 'Lower bound only (at least 80% FTP).' },
  { syntax: '250-300W', meaning: 'Absolute watts range; works without an FTP set. Bounds (<150W, >200W) work too.' },
  { syntax: '30-40km/h', meaning: 'Speed range in km/h. Bounds (<20km/h, >45km/h) work too.' },
  { syntax: '150-165bpm', meaning: 'Average heart rate range in beats per minute. Bounds (<120bpm, >170bpm) work too.' },
  { syntax: '80-90%HRmax', meaning: 'Heart rate as a percentage of the activity\'s max HR (the recorded max, or the highest value in the HR stream). Bounds work too.' },
  { syntax: '90-100rpm', meaning: 'Average cadence range in rpm. Bounds (<60rpm, >110rpm) work too.' },
  { syntax: 'best  /  max', meaning: 'No threshold: find the single highest-average window of that length. On duration steps this means power.' },
  { syntax: 'best power  /  best speed', meaning: 'Required for "best"/"max" on distance steps, which have no default metric.' },
]

export const DSL_RULES = [
  'Line 1 must be the repeat count: "4x", "1x", etc. (1 or greater), or "3 sets of 5x" for sets.',
  'Every following line is one step (or a warmup/cooldown line); at least one "work" step is required.',
  'A repeat can have several work/recovery steps; they are matched in the order written.',
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
    title: 'Heart-rate-controlled blocks',
    description: 'Work by heart rate (bpm or %HRmax) instead of power; needs an HR stream on the activity.',
    dsl: '3x\nwork 10min ±10% @ 150-165bpm\nrecovery 5min ±30% @ <70%HRmax',
  },
  {
    title: 'Cadence drills',
    description: 'High-cadence work bouts with low-cadence recoveries.',
    dsl: '4x\nwork 5min ±15% @ 100-110rpm\nrecovery 3min ±30% @ <70rpm',
  },
  {
    title: 'Ignore warm-up and cool-down',
    description: 'Skip the first 15 and last 10 minutes so openers and a final sprint do not count as reps.',
    dsl: '3x\nwarmup 15min\ncooldown 10min\nwork 10min ±10% @ 90-100%FTP\nrecovery 5min ±30% @ <55%FTP',
  },
  {
    title: 'Multi-step block',
    description: 'Each repeat is a 2-minute tempo step, a 1-minute hard step, then a recovery.',
    dsl: '3x\nwork 2min ±10% @ 95-100%FTP\nwork 1min ±10% @ 105-110%FTP\nrecovery 3min ±30% @ <55%FTP',
  },
  {
    title: 'Over-unders',
    description: 'Back-to-back under/over/under steps, then a recovery; "then" keeps them contiguous.',
    dsl: '4x\nwork 2min ±5% @ 95-100%FTP\nthen work 1min ±5% @ 105-110%FTP\nthen work 2min ±5% @ 95-100%FTP\nrecovery 4min ±30% @ <55%FTP',
  },
  {
    title: 'Pyramid',
    description: 'Ascending then descending steps with no rest in between.',
    dsl: '1x\nwork 1min ±5% @ 100-105%FTP\nthen work 2min ±5% @ 105-110%FTP\nthen work 3min ±5% @ 110-115%FTP\nthen work 2min ±5% @ 105-110%FTP\nthen work 1min ±5% @ 100-105%FTP',
  },
  {
    title: 'Ramp',
    description: 'Stepwise increasing targets.',
    dsl: '1x\nwork 1min ±5% @ 50-60%FTP\nthen work 1min ±5% @ 60-70%FTP\nthen work 1min ±5% @ 70-80%FTP\nthen work 1min ±5% @ >80%FTP',
  },
  {
    title: 'Sets: 3 sets of 5 short efforts',
    description: 'Five 30-second efforts with 30 seconds easy, repeated in three sets separated by 5 minutes of rest.',
    dsl: '3 sets of 5x\nwork 30sec ±20% @ 120-140%FTP\nrecovery 30sec ±50% @ <55%FTP\nset recovery 5min ±30% @ <55%FTP',
  },
  {
    title: 'Threshold with chosen metrics',
    description: 'Report normalized power, variability, power:HR decoupling and HR recovery 30 seconds after each rep.',
    dsl: '3x\nwork 10min ±10% @ 90-100%FTP\nrecovery 5min ±30% @ <55%FTP\nmetrics np, vi, decoupling, hr_recovery(30sec), dropoff, pacing',
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
    dsl: '1x\nwork 5min ±10% @ best\nmetrics np, speedy',
    fix: 'Unknown metric. Use the names listed under "metrics".',
  },
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
  {
    dsl: '1x\nthen work 3min ±5% @ 90-110%FTP',
    fix: '"then" needs a preceding step; remove it from the first step.',
  },
  {
    dsl: '3x\nwork 1min ±5% @ best\nset recovery 5min ±30% @ <55%FTP',
    fix: '"set recovery" needs a sets line first, e.g. "3 sets of 3x".',
  },
]
