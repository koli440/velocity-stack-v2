'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Portal from './Portal'
import { NAV_ITEMS, NAV_LOCKED_LABEL, isNavItemLocked } from '../lib/navigation'
import { parseCoachPath, sidebarItems, isSidebarItemActive, isContextNavActive, navHref, logoHref, chromeVisibility } from '../lib/coachContext'
import Icon from './Icon'
import { loginHref } from '../lib/signupCatch'

export default function Sidebar({
  isOpen = false,
  onClose,
  isAdmin = false,
  signedIn = true,
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { riderId } = parseCoachPath(pathname)
  const items = sidebarItems(NAV_ITEMS, riderId)
  const chrome = chromeVisibility(riderId)

  const handleNavigate = (path) => {
    router.push(path)
    if (onClose) onClose() // close the mobile drawer after clicking
  }

  const navItemClass = (active) =>
    `w-full text-left flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
      active
        ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-brand-neon font-bold'
        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/60'
    }`

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

          {/* Navigation */}
          <nav className="space-y-1">
            {items.map((item) => {
              const locked = isNavItemLocked(item, signedIn)
              if (locked) {
                return (
                  <button
                    key={item.key}
                    onClick={() => handleNavigate(loginHref(item.href))}
                    title={NAV_LOCKED_LABEL}
                    aria-label={`${item.label} (${NAV_LOCKED_LABEL})`}
                    className={`${navItemClass(false)} opacity-60`}
                  >
                    <Icon name={item.icon} size={18} /> <span className="flex-1">{item.label}</span>
                    <Icon name="lock" size={14} />
                  </button>
                )
              }
              return (
                <button
                  key={item.key}
                  onClick={() => handleNavigate(riderId ? item.href : navHref(item, riderId))}
                  className={navItemClass(riderId ? isSidebarItemActive(item, pathname) : isContextNavActive(item, pathname, riderId))}
                >
                  <Icon name={item.icon} size={18} /> {item.label}
                </button>
              )
            })}
            {signedIn && isAdmin && chrome.adminLink && (
              <button
                onClick={() => handleNavigate('/admin/suggestions')}
                className={navItemClass(pathname?.startsWith('/admin'))}
              >
                <Icon name="check" size={18} /> Suggestions
              </button>
            )}
          </nav>
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