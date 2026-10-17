'use client'

import { useRouter, usePathname } from 'next/navigation'
import { NAV_ITEMS } from '../lib/navigation'
import { parseCoachPath, navHref, isContextNavActive } from '../lib/coachContext'
import Icon from './Icon'

export default function Sidebar({
  isOpen = false,
  onClose,
  isAdmin = false,
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { riderId } = parseCoachPath(pathname)

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

  return (
    <>
      {/* 1. Backdrop for mobile view */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs md:hidden animate-fade-in"
        />
      )}

      {/* 2. The panel itself */}
      <aside
        className={`fixed md:sticky top-0 left-0 z-50 h-screen w-64 shrink-0 flex flex-col justify-between p-5 bg-white dark:bg-surface-darkCard border-r border-slate-200 dark:border-surface-darkBorder transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="space-y-6">
          {/* Logo & close icon for mobile */}
          <div className="flex items-center justify-between px-2">
            <div
              onClick={() => handleNavigate('/')}
              className="flex items-center gap-2.5 cursor-pointer"
            >
              <div className="h-7 w-7 rounded-lg bg-emerald-500 dark:bg-brand-neon flex items-center justify-center font-black text-white dark:text-slate-950 text-base shadow-xs">
                V
              </div>
              <span className="font-extrabold tracking-tight text-lg text-slate-900 dark:text-white">
                Velocity<span className="text-emerald-500 dark:text-brand-neon">Stack</span>
              </span>
            </div>

            {/* Close icon visible only on mobile */}
            <button
              onClick={onClose}
              className="md:hidden text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg p-1"
            >
              <Icon name="close" size={18} />
            </button>
          </div>

          {/* Navigation */}
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                onClick={() => handleNavigate(navHref(item, riderId))}
                className={navItemClass(isContextNavActive(item, pathname, riderId))}
              >
                <Icon name={item.icon} size={18} /> {item.label}
              </button>
            ))}
            {isAdmin && (
              <button
                onClick={() => handleNavigate('/admin/suggestions')}
                className={navItemClass(pathname?.startsWith('/admin'))}
              >
                <Icon name="check" size={18} /> Suggestions
              </button>
            )}
          </nav>
        </div>

      </aside>
    </>
  )
}