'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { NAV_ITEMS, isNavItemActive } from '../lib/navigation'
import Icon from './Icon'

export default function Sidebar({
  isOpen = false,
  onClose,
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [isCoach, setIsCoach] = useState(true)

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
                onClick={() => handleNavigate(item.href)}
                className={navItemClass(isNavItemActive(item, pathname))}
              >
                <Icon name={item.icon} size={18} /> {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Bottom Coach / Rider switch */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between px-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {isCoach ? 'Coach View' : 'Rider View'}
          </span>
          <button
            onClick={() => setIsCoach(!isCoach)}
            className={`w-11 h-6 flex items-center rounded-full p-1 transition duration-300 ${
              isCoach
                ? 'bg-emerald-500 dark:bg-brand-neon justify-end'
                : 'bg-slate-300 dark:bg-slate-700 justify-start'
            }`}
          >
            <div className="bg-white dark:bg-slate-950 w-4 h-4 rounded-full shadow-md"></div>
          </button>
        </div>
      </aside>
    </>
  )
}