'use client'

import Link from 'next/link'
import Portal from './Portal'
import Icon from './Icon'
import NewsEntries from './NewsEntries'
import SupportButton from './SupportButton'
import useModalA11y from './useModalA11y'

function NewsModalInner({ entries, onClose }) {
  const dialogRef = useModalA11y(true, onClose)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="news-modal-title"
        tabIndex={-1}
        className="glass-popover bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl text-slate-900 dark:text-slate-100 focus:outline-none"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 id="news-modal-title" className="text-lg font-black">
            What&apos;s new
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="px-5 py-3 overflow-y-auto">
          <NewsEntries entries={entries} onNavigate={onClose} />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 dark:border-surface-darkBorder">
          <p className="text-xs text-slate-500 dark:text-slate-400">Enjoying Velocity Stack?</p>
          <SupportButton />
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-200 dark:border-surface-darkBorder">
          <Link href="/whats-new" onClick={onClose} className="text-xs underline text-slate-600 dark:text-slate-300">
            All updates
          </Link>
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 text-slate-950 hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

// One list of everything unseen, newest first. Closing (Got it / Escape / backdrop) marks all as seen.
export default function NewsModal({ open, entries, onClose }) {
  if (!open || !entries?.length) return null
  return (
    <Portal>
      <NewsModalInner entries={entries} onClose={onClose} />
    </Portal>
  )
}
