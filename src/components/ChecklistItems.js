'use client'

import Link from 'next/link'

// Shared list of checklist rows (dashboard card and last tour page). Ticks come from real data.
export default function ChecklistItems({ checklist, onNavigate }) {
  return (
    <ul className="space-y-1.5">
      {checklist.items.map((item) => (
        <li key={item.id} className="flex items-start gap-2.5 text-sm">
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-black ${
              item.done ? 'bg-emerald-500 border-emerald-500 text-slate-950' : 'border-slate-400 dark:border-slate-600'
            }`}
          >
            {item.done ? '✓' : ''}
          </span>
          <span className="min-w-0">
            {item.done ? (
              <span className="line-through text-slate-500">{item.label}</span>
            ) : (
              <Link href={item.href} onClick={onNavigate} className="font-semibold underline decoration-dotted text-slate-900 dark:text-white">
                {item.label}
              </Link>
            )}
            <span className="sr-only">{item.done ? ' (done)' : ' (not done yet)'}</span>
            {!item.done && <span className="block text-xs text-slate-500 dark:text-slate-400">{item.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}
