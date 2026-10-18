'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Portal from './Portal'
import Icon from './Icon'
import MarkdownBlocks from './MarkdownBlocks'
import ChecklistItems from './ChecklistItems'
import useModalA11y from './useModalA11y'
import { WELCOME_STEPS } from '../lib/onboarding'

const BTN = 'px-3.5 py-1.5 rounded-xl text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'

function WelcomeModalInner({ onClose, checklist, checklistDismissed, onRestoreChecklist }) {
  const [step, setStep] = useState(0)
  const dialogRef = useModalA11y(true, onClose)
  const total = WELCOME_STEPS.length + 1 // the last page is the live checklist
  const last = step === total - 1
  const current = WELCOME_STEPS[step]

  useEffect(() => {
    dialogRef.current?.querySelector('[data-step-title]')?.focus()
  }, [step, dialogRef])

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
        aria-labelledby="welcome-title"
        tabIndex={-1}
        className="glass-popover bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl text-slate-900 dark:text-slate-100 focus:outline-none"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
            Getting started · {step + 1} of {total}
          </p>
          <button type="button" onClick={onClose} aria-label="Close tour" className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="px-5 py-3 overflow-y-auto space-y-3">
          <h2 id="welcome-title" tabIndex={-1} data-step-title className="text-lg font-black focus:outline-none">
            {current ? current.title : 'Your getting-started checklist'}
          </h2>
          {current ? (
            <>
              <MarkdownBlocks source={current.body} onNavigate={onClose} />
              {current.links?.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {current.links.map((l) => (
                    <Link
                      key={l.href + l.label}
                      href={l.href}
                      onClick={onClose}
                      className={`${BTN} border border-emerald-500 text-emerald-700 dark:text-brand-neon hover:bg-emerald-500/10`}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                These tick automatically as you use Velocity Stack.
              </p>
              <ChecklistItems checklist={checklist} onNavigate={onClose} />
              {checklistDismissed && (
                <button type="button" onClick={onRestoreChecklist} className="text-xs underline text-slate-600 dark:text-slate-300">
                  Show this checklist on the dashboard again
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-200 dark:border-surface-darkBorder">
          <button type="button" onClick={onClose} className={`${BTN} text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800`}>
            {last ? 'Close' : 'Skip tour'}
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className={`${BTN} border border-slate-300 dark:border-slate-700`}>
                Back
              </button>
            )}
            {last ? (
              <button type="button" data-autofocus onClick={onClose} className={`${BTN} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>
                Finish
              </button>
            ) : (
              <button type="button" data-autofocus onClick={() => setStep(step + 1)} className={`${BTN} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Skippable welcome tour. Reopened from Help in the user menu (state resets on every open).
export default function WelcomeModal({ open, ...rest }) {
  if (!open) return null
  return (
    <Portal>
      <WelcomeModalInner {...rest} />
    </Portal>
  )
}
