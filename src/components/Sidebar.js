'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function Sidebar({
  isOpen = false,
  onClose,
  onOpenSettings,
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [ridesOpen, setRidesOpen] = useState(true)
  const [isCoach, setIsCoach] = useState(true)

  const handleNavigate = (path) => {
    router.push(path)
    if (onClose) onClose() // zavřít mobilní drawer po kliknutí
  }

  const isHomeActive = pathname === '/'
  const isVelodromeActive = pathname.startsWith('/velodromes')

  const navItemClass = (active) =>
    `w-full text-left flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
      active
        ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-brand-neon font-bold'
        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/60'
    }`

  return (
    <>
      {/* 1. Backdrop pro mobilní zobrazení */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs md:hidden animate-fade-in"
        />
      )}

      {/* 2. Samotný panel */}
      <aside
        className={`fixed md:sticky top-0 left-0 z-50 h-screen w-64 shrink-0 flex flex-col justify-between p-5 bg-white dark:bg-surface-darkCard border-r border-slate-200 dark:border-surface-darkBorder transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="space-y-6">
          {/* Logo & zavírací křížek pro mobil */}
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

            {/* Křížek viditelný pouze na mobilu */}
            <button
              onClick={onClose}
              className="md:hidden text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg p-1"
            >
              ✕
            </button>
          </div>

          {/* Navigace */}
          <nav className="space-y-1">
            <button
              onClick={() => handleNavigate('/')}
              className={navItemClass(isHomeActive)}
            >
              <span>🏠</span> Home Cockpit
            </button>

            {/* Rozbalovací sekce Rides */}
            <div>
              <button
                onClick={() => setRidesOpen(!ridesOpen)}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/60 transition"
              >
                <span className="flex items-center gap-3">
                  <span>🚴</span> Rides
                </span>
                <span className="text-xs">{ridesOpen ? '▾' : '▸'}</span>
              </button>

              {ridesOpen && (
                <div className="ml-8 mt-1 space-y-1 border-l-2 border-slate-100 dark:border-slate-800 pl-3">
                 
                  <span className="block px-4 py-1.5 text-xs text-slate-400 dark:text-slate-500 cursor-not-allowed">
                    Road (Soon)
                  </span>
                </div>
              )}
            </div>
             <button onClick={() => handleNavigate('/velodromes')} className={navItemClass(isVelodromeActive)}>
              Velodromes
            </button>
            <button className={navItemClass(false)}>
              <span>🏋️</span> Gym
            </button>
            <button className={navItemClass(false)}>
              <span>📈</span> Analytics
            </button>
            <button className={navItemClass(false)}>
              <span>👥</span> Team
            </button>

            <button
              onClick={() => {
                if (onClose) onClose()
                if (onOpenSettings) onOpenSettings()
              }}
              className={navItemClass(false)}
            >
              <span>⚙️</span> Settings
            </button>
          </nav>
        </div>

        {/* Spodní přepínač Coach / Rider */}
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