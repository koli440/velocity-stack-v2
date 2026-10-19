'use client'

import { useEffect, useRef, useState } from 'react'
import { runsBadgeLabel } from '../lib/activityTemplateRuns'

const fmtW = (v) => (v == null ? '–' : `${v} W`)

export default function TemplateRunsBadge({ runs, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const label = runsBadgeLabel(runs)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!label) return null
  return (
    <div ref={ref} className={`relative z-10 shrink-0 ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        data-testid="template-runs-badge"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="max-w-[10rem] truncate text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-orange-500"
      >
        🧩 {label}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Template runs"
          data-testid="template-runs-popover"
          className="glass-popover absolute right-0 bottom-full mb-1 z-50 w-64 max-h-40 overflow-y-auto rounded-xl border border-slate-300 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard shadow-xl p-2 text-xs text-slate-700 dark:text-slate-200"
        >
          <ul className="space-y-2">
            {runs.map((r, i) => (
              <li key={r.id || i}>
                <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                  <span className="truncate">{r.name}</span>
                  {r.byCoach && <span className="shrink-0 text-[9px] uppercase px-1.5 rounded-full bg-orange-500/15 text-orange-600">Coach</span>}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Avg {fmtW(r.avgPower)} · NP {fmtW(r.np)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
