'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import CarryLink from './CarryLink'
import { useAuthState } from './AuthState'
import { CATCH_DISMISS_KEY, loginHref, registerHref, shouldShowCatch } from '../lib/signupCatch'

const cta =
  'inline-flex items-center justify-center rounded-xl bg-emerald-500 dark:bg-brand-neon px-4 py-2 text-xs font-bold text-white dark:text-slate-950 hover:opacity-90'

export function CatchLinks() {
  const pathname = usePathname()
  return (
    <div className="flex flex-wrap items-center gap-3">
      <CarryLink href={registerHref(pathname)} className={cta}>Create a free account</CarryLink>
      <CarryLink href={loginHref(pathname)} className="text-xs font-bold text-emerald-600 dark:text-brand-neon hover:underline">
        Log in
      </CarryLink>
    </div>
  )
}

/** Teaser for a personal extra. Signed in: renders the real content; signed out: a locked card with the CTA. */
export function LockedExtra({ title, description, children }) {
  const { user } = useAuthState()
  if (user) return children ?? null
  return (
    <div
      data-testid="locked-extra"
      className="rounded-2xl border border-dashed border-slate-300 dark:border-surface-darkBorder bg-white/60 dark:bg-surface-darkCard/60 p-5 space-y-3"
    >
      <h2 className="text-xs uppercase font-bold text-slate-400">
        <span aria-hidden="true">🔒 </span>{title}
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">{description}</p>
      <CatchLinks />
    </div>
  )
}

/** Small inline hint (e.g. next to a picker) pointing at the free account. */
export function LockedHint({ children }) {
  const { user } = useAuthState()
  const pathname = usePathname()
  if (user) return null
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      <span aria-hidden="true">🔒 </span>{children}{' '}
      <CarryLink href={registerHref(pathname)} className="font-bold text-emerald-600 dark:text-brand-neon hover:underline">
        Create a free account
      </CarryLink>
    </p>
  )
}

/** Dismissible banner shown after meaningful use. Pass a value that changes on every user input. */
export function SignupBanner({ usage }) {
  const { user } = useAuthState()
  const [interactions, setInteractions] = useState(0)
  const [dismissed, setDismissed] = useState(true)
  const first = useRef(true)

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(CATCH_DISMISS_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [])

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setInteractions((n) => n + 1)
  }, [usage])

  if (!shouldShowCatch({ interactions, dismissed, signedIn: !!user })) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(CATCH_DISMISS_KEY, '1')
    } catch {}
  }

  return (
    <div
      role="region"
      aria-label="Create a free account"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4"
    >
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        Like what you see? A free account is required for the full app: save your gear, home track and personal bests.
      </p>
      <div className="flex items-center gap-3">
        <CatchLinks />
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-lg px-2 py-1 text-sm font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
