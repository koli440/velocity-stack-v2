'use client'

import { useState } from 'react'

export default function Sidebar({ currentView = 'home', onViewChange }) {
  const [ridesOpen, setRidesOpen] = useState(true)
  const [isCoach, setIsCoach] = useState(true)

  const navItemClass = (active) =>
    `w-full text-left flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
      active
        ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-brand-neon'
        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/60'
    }`

  return (
    <aside className="w-64 shrink-0 flex flex-col justify-between p-5 bg-white dark:bg-surface-darkCard border-r border-slate-200 dark:border-surface-darkBorder min-h-screen">
      <div className="space-y-6">
        {/* Logo */}
        <div 
          onClick={() => onViewChange('home')}
          className="flex items-center gap-2.5 px-2 cursor-pointer"
        >
          <div className="h-7 w-7 rounded-lg bg-emerald-500 dark:bg-brand-neon flex items-center justify-center font-black text-white dark:text-slate-950 text-base shadow-sm">
            V
          </div>
          <span className="font-extrabold tracking-tight text-lg text-slate-900 dark:text-white">
            Velocity<span className="text-emerald-500 dark:text-brand-neon">Stack</span>
          </span>
        </div>

        {/* Navigace */}
        <nav className="space-y-1">
          <button
            onClick={() => onViewChange('home')}
            className={navItemClass(currentView === 'home')}
          >
            <span>🏠</span> Home
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
                <button
                  onClick={() => onViewChange('velodromes')}
                  className={navItemClass(currentView === 'velodromes')}
                >
                  Velodrome
                </button>
                <span className="block px-4 py-1.5 text-xs text-slate-400 dark:text-slate-500 cursor-not-allowed">
                  Road (Soon)
                </span>
              </div>
            )}
          </div>

          <button className={navItemClass(false)}>
            <span>🏋️</span> Gym
          </button>
          <button className={navItemClass(false)}>
            <span>📈</span> Analytics
          </button>
          <button className={navItemClass(false)}>
            <span>👥</span> Team
          </button>
          <button className={navItemClass(false)}>
            <span>⚙️</span> Settings
          </button>
        </nav>
      </div>

      {/* Přepínač Coach / Rider */}
      <div className="pt-4 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between px-2">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {isCoach ? 'Coach View' : 'Rider View'}
        </span>
        <button
          onClick={() => setIsCoach(!isCoach)}
          className={`w-11 h-6 flex items-center rounded-full p-1 transition duration-300 ${
            isCoach ? 'bg-emerald-500 dark:bg-brand-neon justify-end' : 'bg-slate-300 dark:bg-slate-700 justify-start'
          }`}
        >
          <div className="bg-white dark:bg-slate-950 w-4 h-4 rounded-full shadow-md"></div>
        </button>
      </div>
    </aside>
  )
}