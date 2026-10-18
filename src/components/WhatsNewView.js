'use client'

import { useEffect } from 'react'
import NewsEntries from './NewsEntries'
import { useOnboarding } from './OnboardingProvider'

// Lists every entry; opening the page marks them all as seen (clears the bell indicator).
export default function WhatsNewView({ entries }) {
  const { markNewsSeen, state, unreadNews } = useOnboarding()
  useEffect(() => {
    if (state) markNewsSeen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, unreadNews.length])

  return (
    <div className="max-w-2xl w-full space-y-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white uppercase">What&apos;s new</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">Recent features and improvements, newest first.</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing here yet.</p>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-5">
          <NewsEntries entries={entries} />
        </div>
      )}
    </div>
  )
}
