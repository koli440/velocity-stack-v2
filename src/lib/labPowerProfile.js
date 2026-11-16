// Power profile and phenotype (docs/lab/power-profile.md). Approximate, documented benchmarks:
// W/kg anchors per duration for a male rider at scores 0 / 25 / 50 / 75 / 100 (untrained ... world class),
// women use SEX_FACTOR, masters riders (35+) are age adjusted before scoring. Guidance, not a diagnosis.
export const PROFILE_DURATIONS = Object.freeze([
  { key: '5s', label: '5 s', sec: 5 },
  { key: '1m', label: '1 min', sec: 60 },
  { key: '5m', label: '5 min', sec: 300 },
  { key: '20m', label: '20 min', sec: 1200 },
])

export const MALE_ANCHORS = Object.freeze({
  '5s': [8, 12, 16, 20, 24],
  '1m': [3, 5, 6.8, 8.5, 11],
  '5m': [2, 3.4, 4.6, 5.8, 7],
  '20m': [1.6, 2.8, 3.9, 4.9, 6],
})
export const SEX_FACTOR = Object.freeze({ male: 1, female: 0.88 })
export const ALL_ROUNDER_SPREAD = 8
const AGE_DECLINE_PER_YEAR = 0.008
const AGE_FLOOR = 0.7

export const PHENOTYPE_LABELS = Object.freeze({
  sprinter: 'Sprinter',
  pursuiter: 'Pursuiter',
  time_trialist: 'Time trialist',
  all_rounder: 'All-rounder',
})

/** Multiplier for age: 1 up to 35, then -0.8 % per year, never below 0.7. */
export function ageFactor(age) {
  const a = Number(age)
  if (!(a > 35)) return 1
  return Math.max(AGE_FLOOR, 1 - (a - 35) * AGE_DECLINE_PER_YEAR)
}

/** 0-100 score of W/kg against five anchor points (linear between them, extrapolated to 0..100). */
export function scoreFromAnchors(wkg, anchors) {
  if (!(wkg > 0)) return 0
  if (wkg <= anchors[0]) return 0
  for (let i = 1; i < anchors.length; i++) {
    if (wkg <= anchors[i]) return (i - 1) * 25 + ((wkg - anchors[i - 1]) / (anchors[i] - anchors[i - 1])) * 25
  }
  return 100
}

/** Pulls the best watt value per profile duration from a power curve ({ '5s': 800, '1m': { value } ... }). */
export function bestsFromCurve(curve) {
  const out = {}
  for (const d of PROFILE_DURATIONS) {
    const raw = curve?.[d.key]
    const v = Number(raw && typeof raw === 'object' ? raw.value : raw)
    if (Number.isFinite(v) && v > 0) out[d.key] = v
  }
  return out
}

/** Max per duration over a list of curves. */
export function mergeBests(curves) {
  const out = {}
  for (const c of curves || []) {
    const b = bestsFromCurve(c)
    for (const [k, v] of Object.entries(b)) if (!(out[k] >= v)) out[k] = v
  }
  return out
}

/**
 * Profile of bests (watts per duration) for a rider. Returns { error } without weight, otherwise
 * { rows: [{ key, label, watts, wkg, score }], phenotype, scores }.
 */
export function computeProfile({ bests, weightKg, age = null, sex = 'male' }) {
  const w = Number(weightKg)
  if (!(w > 0)) return { error: 'Add the athlete weight (Physiology > weight) to score the profile' }
  const sexFactor = SEX_FACTOR[sex] ?? 1
  const af = ageFactor(age)
  const rows = PROFILE_DURATIONS.map((d) => {
    const watts = bests?.[d.key] ?? null
    if (!watts) return { key: d.key, label: d.label, watts: null, wkg: null, score: null }
    const wkg = watts / w
    const anchors = MALE_ANCHORS[d.key].map((a) => a * sexFactor)
    return { key: d.key, label: d.label, watts, wkg: Math.round(wkg * 100) / 100, score: Math.round(scoreFromAnchors(wkg / af, anchors)) }
  })
  const scores = Object.fromEntries(rows.map((r) => [r.key, r.score]))
  return { rows, scores, phenotype: classifyPhenotype(scores) }
}

/** Phenotype from the four scores; null when any duration is missing. */
export function classifyPhenotype(scores) {
  const { '5s': s5, '1m': s1, '5m': s5m, '20m': s20 } = scores || {}
  if ([s5, s1, s5m, s20].some((v) => v == null)) return null
  const strengths = {
    sprinter: (2 * s5 + s1) / 3,
    pursuiter: (s1 + s5m) / 2,
    time_trialist: (s5m + 2 * s20) / 3,
  }
  const sorted = Object.entries(strengths).sort((a, b) => b[1] - a[1])
  const spread = sorted[0][1] - sorted[2][1]
  return { type: spread < ALL_ROUNDER_SPREAD ? 'all_rounder' : sorted[0][0], strengths, spread: Math.round(spread) }
}
