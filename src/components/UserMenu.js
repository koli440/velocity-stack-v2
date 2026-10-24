'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { fetchMyCoaching, groupRelationships } from '../lib/coaching'
import { authorName } from '../lib/social'
import { viewingAsOptions, parseCoachPath, chromeVisibility, COACH_HOME_PATH } from '../lib/coachContext'
import { usePathname } from 'next/navigation'
import Avatar from './Avatar'
import { useOnboarding } from './OnboardingProvider'

// Username menu (top right). Offers a "Viewing as" switcher (Me + my athletes) when the user
// coaches anyone. The context is only the URL: picking an athlete navigates to /coach/<id>.
export default function UserMenu({ user, profile, displayName }) {
  const router = useRouter()
  const pathname = usePathname()
  const { riderId } = parseCoachPath(pathname)
  const chrome = chromeVisibility(riderId)
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState({ athletes: [], hasAthletes: false })
  const ref = useRef(null)
  const { openWelcome, unreadNews, enabled: onboardingEnabled } = useOnboarding()

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    ;(async () => {
      const { rows, profiles } = await fetchMyCoaching(supabase, user.id)
      const { athletes } = groupRelationships(rows, user.id)
      const names = {}
      for (const r of athletes) names[r.rider_id] = authorName(profiles.get(r.rider_id))
      if (!cancelled) setOptions(viewingAsOptions(athletes, user.id, names))
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const go = (href) => {
    setOpen(false)
    router.push(href)
  }

  const row = (active) =>
    `w-full text-left px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
      active
        ? 'bg-emerald-500/10 text-emerald-600 dark:text-brand-neon'
        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
    }`

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-emerald-500 transition shadow-2xs"
      >
        <Avatar url={profile?.avatar_url} name={displayName} size="w-6 h-6" textSize="text-[10px]" />
        <span className="hidden sm:inline">{displayName}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-60 z-50 p-2 space-y-1 glass-popover rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder shadow-xl"
        >
          {options.hasAthletes && (
            <div data-testid="viewing-as" className="pb-1 border-b border-slate-100 dark:border-slate-800">
              <p className="px-3 pt-1 pb-1 text-[10px] uppercase font-bold tracking-wider text-slate-400">Viewing as</p>
              <button role="menuitem" onClick={() => go('/')} className={row(!riderId)}>
                {riderId ? 'Me (exit coaching)' : 'Me'}
              </button>
              {options.athletes.map((a) => (
                <button key={a.riderId} role="menuitem" onClick={() => go(a.href)} className={row(riderId === a.riderId)}>
                  {a.label}
                </button>
              ))}
              <button role="menuitem" onClick={() => go(COACH_HOME_PATH)} className={row(false)}>
                Coach dashboard
              </button>
            </div>
          )}
          {chrome.mySettings && (
            <button role="menuitem" onClick={() => go('/settings')} className={row(false)}>
              My settings
            </button>
          )}
          {chrome.help && onboardingEnabled && (
            <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
              <p className="px-3 pt-1 pb-1 text-[10px] uppercase font-bold tracking-wider text-slate-400">Help</p>
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  openWelcome()
                }}
                className={row(false)}
              >
                Getting started
              </button>
              <button role="menuitem" onClick={() => go('/whats-new')} className={row(pathname === '/whats-new')}>
                What&apos;s new{unreadNews.length > 0 ? ` (${unreadNews.length} new)` : ''}
              </button>
              <button role="menuitem" onClick={() => go('/dsl-guide')} className={row(false)}>
                Template syntax guide
              </button>
              <button role="menuitem" onClick={() => go('/import-help')} className={row(pathname === '/import-help')}>
                Import .fit from SRM PC8
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
