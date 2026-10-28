import { formatTooltipRows } from '@/lib/chartTooltip'

export const TOOLTIP_SHELL_CLASS =
  'glass-popover pointer-events-none whitespace-nowrap rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-xs py-2 px-3 shadow-lg'

export function ChartTooltipShell({ label, children }) {
  return (
    <div className={TOOLTIP_SHELL_CLASS}>
      {label != null && label !== '' && (
        <div className="font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 pb-1 mb-1">{label}</div>
      )}
      <div className="space-y-1">{children}</div>
    </div>
  )
}

// Use as <Tooltip content={<ChartTooltip valueFormatter=... labelFormatter=... />} />.
// With `render`, pass (props) => ReactNode for custom body content inside the shared shell.
export default function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter, formatter, render }) {
  if (!active || !payload?.length) return null
  const lbl = labelFormatter ? labelFormatter(label, payload) : label
  if (render) {
    const body = render({ payload, label, formattedLabel: lbl })
    if (body == null) return null
    return <ChartTooltipShell label={lbl}>{body}</ChartTooltipShell>
  }
  const rows = formatTooltipRows(payload, valueFormatter || formatter)
  if (!rows.length) return null
  return (
    <ChartTooltipShell label={lbl}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
          {r.name && <span className="text-slate-500 dark:text-slate-400">{r.name}</span>}
          <span className="ml-auto pl-3 font-bold tabular-nums">{r.value}</span>
        </div>
      ))}
    </ChartTooltipShell>
  )
}
