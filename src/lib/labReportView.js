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
  ].filter(Boolean)
}
