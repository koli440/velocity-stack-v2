// Measurement protocols (docs/lab/measurement-protocols.md): fueling/glucose, bike-fit log, pedalling efficiency,
// cadence/torque profile. Ranges mirror lab_entry_validate (the authoritative check).
export const ENTRY_KINDS = Object.freeze(['fueling', 'fit', 'pedalling', 'cadence'])
export const NOT_MEDICAL_NOTICE = 'Performance and fueling insight, not medical advice. Talk to a doctor about glucose concerns.'
const NOTES_MAX = 500
const MMOL_PER_MGDL = 1 / 18.016
const r1 = (n) => Math.round(n * 10) / 10
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)

export const FIT_FIELDS = Object.freeze([
  { key: 'saddle_height_mm', label: 'Saddle height (mm)', min: 500, max: 1000 },
  { key: 'setback_mm', label: 'Saddle setback (mm)', min: -50, max: 200 },
  { key: 'reach_mm', label: 'Reach (mm)', min: 300, max: 750 },
  { key: 'cleat_mm', label: 'Cleat position, fore/aft offset (mm)', min: -40, max: 40 },
  { key: 'crank_mm', label: 'Crank length (mm)', min: 140, max: 185 },
  { key: 'avg_power_w', label: 'Test power (W, e.g. 20 min)', min: 0, max: 2500 },
  { key: 'comfort', label: 'Comfort (1-5)', min: 1, max: 5 },
])

export const PEDALLING_FIELDS = Object.freeze([
  { key: 'left_balance_pct', label: 'Left balance (%)', min: 30, max: 70 },
  { key: 'te_left', label: 'Torque effectiveness left (%)', min: 0, max: 100 },
  { key: 'te_right', label: 'Torque effectiveness right (%)', min: 0, max: 100 },
  { key: 'ps_left', label: 'Pedal smoothness left (%)', min: 0, max: 100 },
  { key: 'ps_right', label: 'Pedal smoothness right (%)', min: 0, max: 100 },
  { key: 'avg_power_w', label: 'Average power (W)', min: 0, max: 2500 },
])

export const DEFAULT_CADENCES = Object.freeze([60, 70, 80, 90, 100, 110])
export const CADENCE_INSTRUCTION = 'Warm up 15 min. Then ride equal-length steps (3-5 min) at the same perceived effort, each at a set cadence (e.g. 60, 70, 80, 90, 100, 110 rpm). Hold the cadence as steadily as you can, rest 2-3 min between steps, and note the average power (and heart rate) of each step.'

function parseNum(raw, f) {
  const s = String(raw ?? '').trim().replace(',', '.')
  if (s === '') return { skip: true }
  const n = Number(s)
  if (!Number.isFinite(n) || n < f.min || n > f.max) return { error: `${f.label} must be between ${f.min} and ${f.max}` }
  return { n }
}

function numeric(fields, values, notes) {
  const data = {}
  for (const f of fields) {
    const p = parseNum(values?.[f.key], f)
    if (p.error) return p
    if (!p.skip) data[f.key] = p.n
  }
  return withNotes(data, notes)
}

function withNotes(data, notes) {
  const t = String(notes || '').trim()
  if (t.length > NOTES_MAX) return { error: `Notes are limited to ${NOTES_MAX} characters` }
  return { data: t ? { ...data, notes: t } : data }
}

/** Validates a form for `kind`; returns { data } for lab_entry_save or { error }. */
export function buildEntry(kind, values = {}, notes = '') {
  if (kind === 'fit') {
    const r = numeric(FIT_FIELDS, values, notes)
    if (r.data && Object.keys(r.data).filter((k) => k !== 'notes').length === 0) return { error: 'Enter at least one value' }
    return r
  }
  if (kind === 'pedalling') {
    const r = numeric(PEDALLING_FIELDS, values, notes)
    if (r.data && !PEDALLING_FIELDS.slice(0, 5).some((f) => r.data[f.key] != null)) return { error: 'Enter balance, torque effectiveness or smoothness' }
    return r
  }
  if (kind === 'cadence') {
    const steps = []
    for (const s of values?.steps || []) {
      const rpm = parseNum(s.rpm, { label: 'Cadence', min: 30, max: 200 })
      const pw = parseNum(s.power_w, { label: 'Power', min: 1, max: 2500 })
      const hr = parseNum(s.hr, { label: 'Heart rate', min: 30, max: 230 })
      for (const p of [rpm, pw, hr]) if (p.error) return p
      if (rpm.skip && pw.skip) continue
      if (rpm.skip || pw.skip) return { error: 'Each step needs both cadence and power' }
      steps.push(hr.skip ? { rpm: rpm.n, power_w: pw.n } : { rpm: rpm.n, power_w: pw.n, hr: hr.n })
    }
    if (steps.length < 2) return { error: 'Enter at least 2 cadence steps' }
    if (steps.length > 12) return { error: 'At most 12 steps' }
    return withNotes({ steps }, notes)
  }
  if (kind === 'fueling') {
    const session = values?.session
    if (session !== 'fasted' && session !== 'fed') return { error: 'Choose fasted or fed' }
    const readings = (values?.readings || []).map((r) => ({ t: Number(r.t), mmol: Number(r.mmol) }))
    if (readings.length < 2) return { error: 'Enter at least 2 glucose readings' }
    if (readings.length > 80) return { error: 'At most 80 readings' }
    if (readings.some((r) => !Number.isFinite(r.t) || r.t < -180 || r.t > 900 || !Number.isFinite(r.mmol) || r.mmol < 1 || r.mmol > 30)) {
      return { error: 'Readings need minutes (-180 to 900) and glucose 1-30 mmol/L' }
    }
    const extra = {}
    for (const f of [
      { key: 'carbs_g_per_h', label: 'Carbs (g/h)', min: 0, max: 250 },
      { key: 'avg_power_w', label: 'Average power (W)', min: 0, max: 2500 },
      { key: 'duration_min', label: 'Ride duration (min)', min: 1, max: 1200 },
    ]) {
      const p = parseNum(values?.[f.key], f)
      if (p.error) return p
      if (!p.skip) extra[f.key] = p.n
    }
    if (extra.duration_min == null) return { error: 'Ride duration (min) is required' }
    return withNotes({ session, readings: readings.sort((a, b) => a.t - b.t), ...extra }, notes)
  }
  return { error: 'Unknown protocol' }
}

/** Parses manual glucose lines "minutes,value[mmol|mg]" (one per line) with a default unit. */
export function parseReadingLines(text, unit = 'mmol') {
  const readings = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(\d+(?:[.,]\d+)?)$/)
    if (!line.trim()) continue
    if (!m) return { error: `Cannot read line "${line.trim().slice(0, 30)}". Use: minutes, glucose` }
    const v = Number(m[2].replace(',', '.'))
    readings.push({ t: Math.round(Number(m[1].replace(',', '.'))), mmol: r1(unit === 'mg' ? v * MMOL_PER_MGDL : v) })
  }
  return { readings }
}

function splitCsv(line, delim) {
  const out = []
  let cur = ''
  let q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === delim && !q) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const parseTs = (s) => {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/) || String(s).match(/^(\d{2})[-./](\d{2})[-./](\d{4})[T ](\d{2}):(\d{2})/)
  if (!m) return null
  const iso = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]]
  return Date.UTC(+iso[0], +iso[1] - 1, +iso[2], +m[4], +m[5]) / 60000
}

/**
 * Libre (FreeStyle LibreView) and Dexcom Clarity CSV -> readings relative to the ride start.
 * startLocal "YYYY-MM-DDTHH:mm" is the ride start in the same clock as the CSV. Keeps one reading per 5 min within
 * [-60, duration+90] min of the ride, at most 80.
 */
export function parseGlucoseCsv(text, startLocal, durationMin) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim())
  const start = parseTs(startLocal)
  if (start == null) return { error: 'Enter the ride start date and time' }
  const dur = Number(durationMin)
  if (!Number.isFinite(dur) || dur <= 0) return { error: 'Enter the ride duration first' }
  const hi = lines.findIndex((l) => /timestamp/i.test(l) && /glucose/i.test(l))
  if (hi < 0) return { error: 'Unrecognised CSV: expected a Timestamp and a Glucose column (Libre or Dexcom export)' }
  const delim = (lines[hi].match(/;/g) || []).length > (lines[hi].match(/,/g) || []).length ? ';' : (lines[hi].includes('\t') ? '\t' : ',')
  const head = splitCsv(lines[hi], delim)
  const tsCol = head.findIndex((h) => /timestamp/i.test(h))
  const gCols = head.map((h, i) => (/glucose/i.test(h) && !/scan|strip|ketone|insulin|carb/i.test(h) ? i : -1)).filter((i) => i >= 0)
  if (tsCol < 0 || gCols.length === 0) return { error: 'Unrecognised CSV: expected a Timestamp and a Glucose column (Libre or Dexcom export)' }
  const buckets = new Map()
  for (const line of lines.slice(hi + 1)) {
    const cells = splitCsv(line, delim)
    const ts = parseTs(cells[tsCol])
    if (ts == null) continue
    const col = gCols.find((i) => cells[i] !== undefined && cells[i] !== '' && Number.isFinite(Number(String(cells[i]).replace(',', '.'))))
    if (col === undefined) continue
    let v = Number(String(cells[col]).replace(',', '.'))
    if (/mg\/?dl/i.test(head[col]) || v > 35) v *= MMOL_PER_MGDL
    const t = ts - start
    if (t < -60 || t > dur + 90 || v < 1 || v > 30) continue
    const b = Math.round(t / 5) * 5 || 0
    if (!buckets.has(b)) buckets.set(b, { t: b, mmol: r1(v) })
  }
  const readings = [...buckets.values()].sort((a, b) => a.t - b.t).slice(0, 80)
  if (readings.length < 2) return { error: 'No glucose readings found around that ride' }
  return { readings }
}

/** Glucose summary for one fueling session: before / during / after (30 and 60 min). */
export function summarizeFueling(d = {}) {
  const rs = d.readings || []
  const dur = d.duration_min ?? Math.max(0, ...rs.map((r) => r.t))
  const vals = (f) => rs.filter(f).map((r) => r.mmol)
  const before = vals((r) => r.t <= 0)
  const during = vals((r) => r.t > 0 && r.t <= dur)
  const near = (target) => {
    const c = rs.filter((r) => r.t > dur && Math.abs(r.t - (dur + target)) <= 10)
    return c.length ? c.sort((a, b) => Math.abs(a.t - dur - target) - Math.abs(b.t - dur - target))[0].mmol : null
  }
  return {
    before: before.length ? r1(before[before.length - 1]) : null,
    duringAvg: during.length ? r1(mean(during)) : null,
    duringMin: during.length ? Math.min(...during) : null,
    duringMax: during.length ? Math.max(...during) : null,
    after30: near(30),
    after60: near(60),
  }
}

/** Fasted vs fed comparison: mean of the per-session summaries (+ carbs/h, power). Needs one of each to compare. */
export function compareFastedFed(entries) {
  const out = {}
  for (const s of ['fasted', 'fed']) {
    const list = (entries || []).filter((e) => e.kind === 'fueling' && e.data?.session === s)
    if (!list.length) continue
    const sums = list.map((e) => summarizeFueling(e.data))
    const avg = (f) => { const v = f.filter((x) => x != null); return v.length ? r1(mean(v)) : null }
    out[s] = {
      sessions: list.length,
      carbs: avg(list.map((e) => e.data.carbs_g_per_h)),
      power: avg(list.map((e) => e.data.avg_power_w)),
      duringAvg: avg(sums.map((x) => x.duringAvg)),
      duringMin: avg(sums.map((x) => x.duringMin)),
      after60: avg(sums.map((x) => x.after60)),
    }
  }
  return out
}

/** Change of each fit value versus the next older entry (rows newest first). */
export function fitDeltas(rows) {
  const list = (rows || []).filter((r) => r.kind === 'fit')
  if (list.length < 2) return {}
  const out = {}
  for (const f of FIT_FIELDS) {
    const a = list[0].data?.[f.key]
    const b = list[1].data?.[f.key]
    if (typeof a === 'number' && typeof b === 'number' && a !== b) out[f.key] = r1(a - b)
  }
  return out
}

/** Pedalling trend: mean of the newest 3 rides vs the 3 before; needs >= 2 rides. Rows newest first. */
export function pedallingTrend(rows) {
  const list = (rows || []).filter((r) => r.kind === 'pedalling')
  const out = {}
  for (const f of PEDALLING_FIELDS.slice(0, 5)) {
    const v = list.map((r) => r.data?.[f.key]).filter((x) => typeof x === 'number')
    if (v.length < 2) continue
    const recent = v.slice(0, 3)
    const prior = v.slice(3, 6)
    out[f.key] = { latest: v[0], recent: r1(mean(recent)), change: prior.length ? r1(mean(recent) - mean(prior)) : null, series: [...v].reverse().slice(-12) }
  }
  return out
}

/** Power per cadence (best first marked) with % of the best step. Steps sorted by cadence. */
export function cadenceProfile(steps) {
  const s = [...(steps || [])].sort((a, b) => a.rpm - b.rpm)
  const best = Math.max(0, ...s.map((x) => x.power_w))
  return s.map((x) => ({ ...x, pctOfBest: best ? Math.round((x.power_w / best) * 100) : null, best: x.power_w === best }))
}

export function summarizeEntry(kind, d = {}) {
  if (kind === 'fueling') {
    const s = summarizeFueling(d)
    return `${d.session} · during ${s.duringAvg ?? '-'} mmol/L avg (min ${s.duringMin ?? '-'})${d.carbs_g_per_h != null ? ` · ${d.carbs_g_per_h} g/h carbs` : ''}${d.avg_power_w != null ? ` · ${d.avg_power_w} W` : ''}`
  }
  if (kind === 'cadence') {
    const best = cadenceProfile(d.steps).find((x) => x.best)
    return `${(d.steps || []).length} steps · best ${best?.power_w} W at ${best?.rpm} rpm`
  }
  const fields = kind === 'fit' ? FIT_FIELDS : PEDALLING_FIELDS
  return fields.filter((f) => d[f.key] != null).map((f) => `${f.label.replace(/ \(.*\)/, '')} ${d[f.key]}`).join(' · ')
}
