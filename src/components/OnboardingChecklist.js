'use client'

import { useOnboarding } from './OnboardingProvider'
import ChecklistItems from './ChecklistItems'
import { shouldShowChecklist } from '../lib/onboarding'

// Dashboard card: stays until every item is done or the rider dismisses it. Own state only.
export default function OnboardingChecklist() {
  const { enabled, state, checklist, factsLoaded, openWelcome, dismissChecklist } = useOnboarding()
  if (!enabled || !factsLoaded || !shouldShowChecklist(state, checklist)) return null

  return (
    <section
      aria-labelledby="getting-started-title"
      className="rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="getting-started-title" className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-white">
            Getting started
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {checklist.doneCount} of {checklist.total} done. Items tick automatically.
          </p>
        </div>
        <div className="flex shrink-0 gap-3 text-xs">
          <button type="button" onClick={openWelcome} className="underline text-slate-600 dark:text-slate-300">
            Tour
          </button>
          <button type="button" onClick={dismissChecklist} className="underline text-slate-600 dark:text-slate-300">
            Dismiss
          </button>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label="Getting started progress"
        aria-valuemin={0}
        aria-valuemax={checklist.total}
        aria-valuenow={checklist.doneCount}
        className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden"
      >
        <div className="h-full bg-emerald-500" style={{ width: `${(checklist.doneCount / checklist.total) * 100}%` }} />
      </div>
      <ChecklistItems checklist={checklist} />
    </section>
  )
}
