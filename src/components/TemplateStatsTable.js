import { buildStatRows } from '../lib/templateStats'

// Single-column metric list: label left, "avg / best" right-aligned and never wrapped.
export default function TemplateStatsTable({ keys, metrics, showBest = true, caption = 'Template statistics' }) {
  const rows = buildStatRows(keys, metrics)
  if (rows.length === 0) return null
  const num = 'py-0.5 pl-2 text-right font-mono tabular-nums whitespace-nowrap'
  return (
    <table className="w-full border-collapse text-slate-500 dark:text-slate-400">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-[10px] text-slate-400">
          <th scope="col" className="py-0.5 text-left font-normal">Metric</th>
          <th scope="col" colSpan={2} className="py-0.5 pl-2 text-right font-normal whitespace-nowrap">{showBest ? 'Avg / Best' : 'Avg'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <th scope="row" className="py-0.5 pr-1 text-left font-normal">{r.label}</th>
            <td className={`${num} text-slate-700 dark:text-slate-200`}>{r.avg}</td>
            {showBest && (
              <td className={`${num} text-slate-400`}>{r.best != null ? `/ ${r.best}` : ''}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
