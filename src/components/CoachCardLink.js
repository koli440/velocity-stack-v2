'use client'

import Link from 'next/link'
import { useCoachModule } from './useCoachModule'

// Settings entry for coaches in the module; invisible while the flag is off.
export default function CoachCardLink() {
  const enabled = useCoachModule()
  if (!enabled) return null
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Coach card</h2>
        <p className="text-xs text-slate-500">Your public coaching page and optional directory listing.</p>
      </div>
      <Link href="/settings/coach-card" className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900">Edit</Link>
    </section>
  )
}
