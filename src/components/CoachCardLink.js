'use client'

import Link from 'next/link'
import Icon from './Icon'
import { adminBtn } from './admin/AdminUi'
import { useCoachModule } from './useCoachModule'

// Settings entry for coaches in the module; invisible while the flag is off.
export default function CoachCardLink() {
  const enabled = useCoachModule()
  if (!enabled) return null
  return (
    <section className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-5 md:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2"><Icon name="users" /> Coach card</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Your public coaching page and optional directory listing.</p>
      </div>
      <Link href="/settings/coach-card" className={`${adminBtn.primary} shrink-0`}><Icon name="edit" /> Edit</Link>
    </section>
  )
}
