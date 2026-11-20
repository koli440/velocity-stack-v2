'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Portal from './Portal'
import { buildNavTree } from '../lib/navigation'
import { parseCoachPath, buildAthleteTree, logoHref, chromeVisibility } from '../lib/coachContext'
import Icon from './Icon'
import { supabase } from '../lib/supabase'
import { totalUnread } from '../lib/coachChat'
import NavTree from './NavTree'
import useNavThreads from './useNavThreads'
import { fetchPaymentOverview } from '../lib/coachBilling'
import { fetchAthleteProfile } from '../lib/coaching'
import { useCoachModule } from './useCoachModule'
import { useMacroPlanner } from './useMacroPlanner'

export default function Sidebar({
  isOpen = false,
  onClose,
  isAdmin = false,
  signedIn = true,
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { riderId } = parseCoachPath(pathname)
  const moduleEnabled = useCoachModule()
  const plannerEnabled = useMacroPlanner()
  const threads = useNavThreads(signedIn)
  const [hasPayments, setHasPayments] = useState(false)
  useEffect(() => {
    if (!signedIn) return setHasPayments(false)
    let cancelled = false
    fetchPaymentOverview(supabase).then(({ overview }) => { if (!cancelled) setHasPayments(overview.as_rider.length + overview.as_coach.length > 0) })
    return () => { cancelled = true }
  }, [signedIn])
  const unread = totalUnread(threads)
  const [athleteName, setAthleteName] = useState(null)
  useEffect(() => {
    setAthleteName(null)
    if (!riderId) return
    let cancelled = false
    fetchAthleteProfile(supabase, riderId).then(({ athlete }) => { if (!cancelled) setAthleteName(athlete?.display_name || null) })
    return () => { cancelled = true }
  }, [riderId])
  const tree = riderId ? buildAthleteTree(riderId, athleteName, moduleEnabled, threads, plannerEnabled) : buildNavTree({ signedIn, isAdmin: isAdmin && chromeVisibility(riderId).adminLink, moduleEnabled, threads, hasPayments })
  const chrome = chromeVisibility(riderId)

  const handleNavigate = (path) => {
    router.push(path)
    if (onClose) onClose() // close the mobile drawer after clicking
  }

  // Close the drawer on navigation and on Escape.
  useEffect(() => {
    if (isOpen && onClose) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const panel = (mobile) => (
        <div className="space-y-6">
          {/* Logo & close icon for mobile */}
          <div className="flex items-center justify-between px-2">
            <div
              onClick={() => handleNavigate(logoHref(riderId))}
              className="flex items-center gap-2.5 cursor-pointer"
            >
              <div className="h-7 w-7 rounded-lg bg-emerald-500 dark:bg-brand-neon flex items-center justify-center font-black text-white dark:text-slate-950 text-base shadow-xs">
                V
              </div>
              <span className="font-extrabold tracking-tight text-lg text-slate-900 dark:text-white">
                Velocity<span className="text-emerald-500 dark:text-brand-neon">Stack</span>
              </span>
            </div>

            {mobile && (
              <button
                onClick={onClose}
                aria-label="Close navigation menu"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg p-1"
              >
                <Icon name="close" size={18} />
              </button>
            )}
          </div>

          {/* Navigation: grouped tree (the athlete tree in athlete context) */}
          <NavTree tree={tree} pathname={pathname} signedIn={signedIn} unread={unread} touch={mobile} onNavigate={mobile ? onClose : undefined} />
        </div>
  )

  return (
    <>
      {/* Persistent sidebar from lg (1024px) up */}
      <aside className="hidden lg:flex sticky top-0 left-0 z-50 h-screen w-64 shrink-0 flex-col justify-between p-5 glass-nav bg-white dark:bg-surface-darkCard border-r border-slate-200 dark:border-surface-darkBorder">
        {panel(false)}
      </aside>

      {/* Mobile/tablet drawer, portalled to <body> so no ancestor (sticky header, glass
          backdrop-filter, transforms) can clip it or become its containing block. */}
      <Portal>
        <div className="lg:hidden">
          {isOpen && (
            <div
              onClick={onClose}
              data-testid="sidebar-backdrop"
              className="fixed inset-0 z-[60] bg-slate-950/60 animate-fade-in"
            />
          )}
          <aside
            data-testid="sidebar-drawer"
            aria-hidden={!isOpen}
            className={`fixed top-0 left-0 z-[70] h-dvh w-64 max-w-[85vw] overflow-y-auto flex flex-col justify-between p-5 glass-popover bg-white dark:bg-surface-darkCard border-r border-slate-200 dark:border-surface-darkBorder shadow-2xl transition-[transform,visibility] duration-300 ease-in-out ${
              isOpen ? 'translate-x-0' : '-translate-x-full invisible'
            }`}
          >
            {panel(true)}
          </aside>
        </div>
      </Portal>
    </>
  )
}