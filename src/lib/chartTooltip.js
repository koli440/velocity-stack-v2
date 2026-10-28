// Pure helpers for the shared chart tooltip.

export function formatTooltipRows(payload, valueFormatter) {
  if (!Array.isArray(payload)) return []
  const rows = []
  for (const item of payload) {
    if (!item || item.value == null || item.hide) continue
    let name = item.name ?? item.dataKey
    let value = item.value
    if (valueFormatter) {
      const out = valueFormatter(item.value, item.name, item)
      if (Array.isArray(out)) {
        value = out[0]
        if (out[1] != null) name = out[1]
      } else {
        value = out
      }
    }
    if (value == null) continue
    rows.push({ name: name == null ? '' : String(name), value: String(value), color: item.color || item.stroke || item.fill || '#94a3b8' })
  }
  return rows
}

export const TOOLTIP_CURSOR_LINE = { stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }
export const TOOLTIP_CURSOR_BAR = { fill: 'rgba(148,163,184,0.15)' }
