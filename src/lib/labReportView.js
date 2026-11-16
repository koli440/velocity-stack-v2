// Pure view helpers for the public lab report page.
const has = (v) => v != null && v !== ''

export function formatWatts(w, hr) {
  if (!has(w)) return null
  return `${w} W${has(hr) ? ` · ${hr} bpm` : ''}`
}

/** KPI tiles for the thresholds block; tiles without data are omitted. */
export function thresholdTiles(t) {
  if (!t) return []
  const tiles = [
    { key: 'ftp', label: 'FTP', value: has(t.ftp_w) ? String(t.ftp_w) : null, unit: 'W', sub: null },
    { key: 'lt1', label: 'LT1', value: has(t.lt1_power_w) ? String(t.lt1_power_w) : null, unit: 'W', sub: has(t.lt1_hr) ? `${t.lt1_hr} bpm` : null },
    { key: 'lt2', label: 'LT2', value: has(t.lt2_power_w) ? String(t.lt2_power_w) : null, unit: 'W', sub: has(t.lt2_hr) ? `${t.lt2_hr} bpm` : null },
  ]
  return tiles.filter((x) => x.value != null)
}

export function phenotypeRows(p) {
  if (!p) return []
  return ['5s', '1m', '5m', '20m'].filter((k) => has(p[k])).map((k) => ({ label: `Best ${k}`, value: `${p[k]} W/kg` }))
}

export function testSummary(t) {
  return [t.protocol, has(t.ftp) ? `FTP ${t.ftp} W` : null, has(t.cp) ? `CP ${t.cp} W` : null].filter(Boolean)
}

export function bodyRows(f) {
  if (!f) return []
  return [
    has(f.weight_kg) ? { label: 'Weight', value: `${f.weight_kg} kg` } : null,
    has(f.body_fat_pct) ? { label: 'Body fat', value: `${f.body_fat_pct} %` } : null,
    has(f.mobility_total) ? { label: 'Mobility checks passed', value: `${f.mobility_pass ?? 0}/${f.mobility_total}` } : null,
    has(f.sprint_time_s) ? { label: 'Sprint', value: `${f.sprint_distance_m} m in ${f.sprint_time_s} s` } : null,
  ].filter(Boolean)
}

const line = (parts) => parts.filter(Boolean).join(' · ')
const w = (v, unit) => (has(v) ? `${v} ${unit}` : null)

export function lactateRows(l) {
  if (!l) return []
  return [
    has(l.lt1_power_w) ? { label: 'LT1', value: line([w(l.lt1_power_w, 'W'), w(l.lt1_hr, 'bpm')]) } : null,
    has(l.lt2_power_w) ? { label: 'LT2', value: line([w(l.lt2_power_w, 'W'), w(l.lt2_hr, 'bpm')]) } : null,
    has(l.obla2_power_w) ? { label: 'OBLA 2 mmol', value: `${l.obla2_power_w} W` } : null,
    has(l.obla4_power_w) ? { label: 'OBLA 4 mmol', value: `${l.obla4_power_w} W` } : null,
  ].filter(Boolean)
}

export const durabilityLines = (list) => (Array.isArray(list) ? list : []).map((t) => `${t.date}: fresh ${t.fresh_w} W, after ${t.kj} kJ ${t.fatigued_w} W (${t.drop_pct >= 0 ? '-' : '+'}${Math.abs(t.drop_pct)} %)`)
export const decouplingLines = (list) => (Array.isArray(list) ? list : []).map((t) => `${t.date}: ${t.avg_w} W, EF ${t.ef}, decoupling ${t.decoupling_pct} %`)
export const aeroLines = (list) => (Array.isArray(list) ? list : []).map((t) => line([t.date, t.position, w(t.cda, 'CdA'), w(t.speed_kmh, 'km/h'), w(t.power_w, 'W')]))
export const fuelingLines = (list) => (Array.isArray(list) ? list : []).map((t) => line([t.date, t.session, w(t.carbs_g_per_h, 'g/h carbs'), w(t.avg_power_w, 'W'), has(t.during_avg) ? `glucose ${t.during_avg} mmol/L avg (min ${t.during_min ?? '-'})` : null, has(t.after60) ? `${t.after60} mmol/L 60 min after` : null]))

export function fitRows(f) {
  if (!f) return []
  return [
    ['Saddle height', f.saddle_height_mm, 'mm'], ['Setback', f.setback_mm, 'mm'], ['Reach', f.reach_mm, 'mm'], ['Cleat offset', f.cleat_mm, 'mm'],
    ['Crank length', f.crank_mm, 'mm'], ['Test power', f.avg_power_w, 'W'], ['Comfort', f.comfort, '/ 5'],
  ].filter(([, v]) => has(v)).map(([label, v, u]) => ({ label: f.date && label === 'Saddle height' ? `${label} (${f.date})` : label, value: `${v} ${u}` }))
}

export function pedallingRows(p) {
  if (!p) return []
  const labels = { left_balance_pct: 'Left balance %', te_left: 'Torque eff. left %', te_right: 'Torque eff. right %', ps_left: 'Smoothness left %', ps_right: 'Smoothness right %' }
  return Object.entries(labels).filter(([k]) => has(p[k])).map(([k, label]) => ({ label, value: `${p[k]}${has(p[`${k}_change`]) ? ` (${p[`${k}_change`] > 0 ? '+' : ''}${p[`${k}_change`]} vs before)` : ''}` }))
}

export const cadenceRows = (c) => (c && Array.isArray(c.steps) ? c.steps.map((s) => ({ label: `${s.rpm} rpm`, value: `${s.power_w} W${s.rpm === c.best_rpm ? ' (best)' : ''}` })) : [])
