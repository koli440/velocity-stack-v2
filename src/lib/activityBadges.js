// Feed badges (issue #49). Pure functions: given a user's activity history (and
// optionally personal bests), decide which activities earned which badges.
// Activities are evaluated chronologically against *prior* activities only, so
// historic imports only earn badges for genuine progression.

export const BADGE_CONFIG = Object.freeze({
  minPriorForPercentile: 10,
  minPriorForRecord: 3,
  topPercentile: 0.9,
  improvementPct: 3,
  hardIntensityFactor: 1.0,
  bigClimbMinM: 300,
  maxVisible: 3,
})

export const BADGE_KINDS = Object.freeze({
  PB: { label: 'New PB', tone: 'gold', priority: 1 },
  POWER_RECORD: { label: 'Power record', tone: 'gold', priority: 2 },
  SPEED_RECORD: { label: 'Speed record', tone: 'gold', priority: 3 },
  IMPROVEMENT: { label: 'Improvement', tone: 'green', priority: 4 },
  HARD_SESSION: { label: 'Hard session', tone: 'rose', priority: 5 },
  LONG_RIDE: { label: 'Long ride', tone: 'blue', priority: 6 },
  BIG_CLIMB: { label: 'Big climb', tone: 'purple', priority: 7 },
  HIGH_POWER: { label: 'High power', tone: 'purple', priority: 8 },
  TOP_SPEED: { label: 'Top speed', tone: 'blue', priority: 9 },
  CURVE_RECORD: { label: 'Power curve record', tone: 'gold', priority: 2 },
  MILESTONE: { label: 'Milestone', tone: 'blue', priority: 10 },
})

// Durations (keys of the stored Power curve) that can earn a power-curve record.
export const CURVE_RECORD_KEYS = Object.freeze(['5s', '1m', '5m', '20m', '1h'])
export const CURVE_KEY_LABELS = Object.freeze({ '5s': '5 s', '1m': '1 min', '5m': '5 min', '20m': '20 min', '1h': '1 h' })
export const SESSION_MILESTONES = Object.freeze([10, 25, 50, 100, 250, 500, 1000])
export const DISTANCE_MILESTONES_KM = Object.freeze([100, 500, 1000, 2500, 5000, 10000, 25000])

/** Reduces badges to what is persisted in `activities.badges`. */
export function serializeBadges(badges = []) {
  return badges.map(({ kind, detail }) => ({ kind, detail }))
}

/** Rebuilds display badges (label/tone/priority) from persisted `{ kind, detail }` rows. */
export function hydrateBadges(stored) {
  if (!Array.isArray(stored)) return []
  return stored
    .filter((b) => b && BADGE_KINDS[b.kind])
    .map((b) => ({ kind: b.kind, detail: b.detail || '', ...BADGE_KINDS[b.kind] }))
    .sort((a, b) => a.priority - b.priority)
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

function percentile(sorted, p) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)
  return sorted[Math.max(0, idx)]
}

function insertSorted(arr, value) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < value) lo = mid + 1
    else hi = mid
  }
  arr.splice(lo, 0, value)
}

const dateOf = (a) => a.activity_date || a.created_at || ''
const dayOf = (a) => String(dateOf(a)).slice(0, 10)

/**
 * @param {Array<object>} activities - need id, activity_date, and any of the metric columns
 * @param {Array<object>} [personalBests] - rows with achieved_date and optional track_id
 * @param {object} [config]
 * @returns {Map<string, Array<{ kind: string, label: string, tone: string, detail: string }>>}
 */
export function computeActivityBadges(activities = [], personalBests = [], config = {}) {
  const cfg = { ...BADGE_CONFIG, ...config }
  const ordered = [...activities].sort((a, b) => {
    const da = dateOf(a)
    const db = dateOf(b)
    if (da !== db) return da < db ? -1 : 1
    return String(a.id) < String(b.id) ? -1 : 1
  })

  const metrics = {
    max_power_w: [],
    max_speed_kmh: [],
    distance_m: [],
    elevation_gain_m: [],
  }
  let prevAvgPower = null
  let sessionCount = 0
  let totalDistanceM = 0
  const bestCurve = {}
  let priorCurveActivities = 0
  const result = new Map()

  const pbDays = new Map()
  for (const pb of personalBests) {
    if (!pb?.achieved_date) continue
    const day = String(pb.achieved_date).slice(0, 10)
    if (!pbDays.has(day)) pbDays.set(day, [])
    pbDays.get(day).push(pb)
  }

  for (const act of ordered) {
    const badges = []
    const add = (kind, detail) => badges.push({ kind, ...BADGE_KINDS[kind], detail })

    const pbs = pbDays.get(dayOf(act)) || []
    const pb = pbs.find((p) => !p.track_id || !act.track_id || p.track_id === act.track_id)
    if (pb) add('PB', pb.discipline ? `${pb.discipline} personal best` : 'Personal best set')

    const maxPower = num(act.max_power_w)
    const maxSpeed = num(act.max_speed_kmh)
    const distance = num(act.distance_m)
    const elevation = num(act.elevation_gain_m)

    if (maxPower && metrics.max_power_w.length >= cfg.minPriorForRecord) {
      const best = metrics.max_power_w[metrics.max_power_w.length - 1]
      if (maxPower > best) add('POWER_RECORD', `+${Math.round(maxPower - best)} W over previous best`)
      else if (
        metrics.max_power_w.length >= cfg.minPriorForPercentile &&
        maxPower >= percentile(metrics.max_power_w, cfg.topPercentile)
      )
        add('HIGH_POWER', 'Top 10% peak power')
    }
    if (maxSpeed && metrics.max_speed_kmh.length >= cfg.minPriorForRecord) {
      const best = metrics.max_speed_kmh[metrics.max_speed_kmh.length - 1]
      if (maxSpeed > best) add('SPEED_RECORD', `+${(maxSpeed - best).toFixed(1)} km/h over previous best`)
      else if (
        metrics.max_speed_kmh.length >= cfg.minPriorForPercentile &&
        maxSpeed >= percentile(metrics.max_speed_kmh, cfg.topPercentile)
      )
        add('TOP_SPEED', 'Top 10% top speed')
    }

    const avgPower = num(act.avg_power_w)
    if (avgPower && prevAvgPower) {
      const pct = ((avgPower - prevAvgPower) / prevAvgPower) * 100
      if (pct >= cfg.improvementPct) add('IMPROVEMENT', `+${pct.toFixed(1)}% avg power vs previous session`)
    }

    if (num(act.intensity_factor) && act.intensity_factor >= cfg.hardIntensityFactor)
      add('HARD_SESSION', `Intensity factor ${act.intensity_factor.toFixed(2)}`)

    if (
      distance &&
      metrics.distance_m.length >= cfg.minPriorForPercentile &&
      distance >= percentile(metrics.distance_m, cfg.topPercentile)
    )
      add('LONG_RIDE', 'Top 10% distance')

    if (
      elevation &&
      elevation >= cfg.bigClimbMinM &&
      metrics.elevation_gain_m.length >= cfg.minPriorForPercentile &&
      elevation >= percentile(metrics.elevation_gain_m, cfg.topPercentile)
    )
      add('BIG_CLIMB', `${Math.round(elevation)} m climbed`)

    const curve = act.power_curve && typeof act.power_curve === 'object' ? act.power_curve : null
    const curveRecords = []
    if (curve) {
      for (const key of CURVE_RECORD_KEYS) {
        const value = num(Number(curve[key]))
        if (!value) continue
        const best = bestCurve[key]
        if (best && priorCurveActivities >= cfg.minPriorForRecord && value > best) {
          curveRecords.push(`${CURVE_KEY_LABELS[key]} +${Math.round(value - best)} W`)
        }
      }
      if (curveRecords.length) add('CURVE_RECORD', curveRecords.join(', '))
    }

    sessionCount++
    const prevDistanceKm = totalDistanceM / 1000
    totalDistanceM += distance || 0
    const distanceKm = totalDistanceM / 1000
    if (SESSION_MILESTONES.includes(sessionCount)) {
      add('MILESTONE', `${sessionCount}th session`)
    } else {
      const crossed = DISTANCE_MILESTONES_KM.filter((m) => prevDistanceKm < m && distanceKm >= m)
      if (crossed.length) add('MILESTONE', `${crossed[crossed.length - 1].toLocaleString()} km total`)
    }

    badges.sort((a, b) => a.priority - b.priority)
    result.set(act.id, badges)

    if (maxPower) insertSorted(metrics.max_power_w, maxPower)
    if (maxSpeed) insertSorted(metrics.max_speed_kmh, maxSpeed)
    if (distance) insertSorted(metrics.distance_m, distance)
    if (elevation) insertSorted(metrics.elevation_gain_m, elevation)
    if (avgPower) prevAvgPower = avgPower
    if (curve) {
      for (const key of CURVE_RECORD_KEYS) {
        const value = num(Number(curve[key]))
        if (value && (!bestCurve[key] || value > bestCurve[key])) bestCurve[key] = value
      }
      priorCurveActivities++
    }
  }

  return result
}
