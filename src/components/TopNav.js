'use client'

import ThemeToggle from './ThemeToggle'

export default function TopNav({
  user,
  profile,
  onOpenMobileMenu,
  onOpenSettings,
  onSignOut,
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 sm:px-8 py-3.5 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-slate-200 dark:border-surface-darkBorder">
      {/* Levá část: Hamburger na mobilu + vyhledávání */}
      <div className="flex items-center gap-3 w-full max-w-md">
        <button
          onClick={onOpenMobileMenu}
          className="md:hidden p-2 rounded-xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard text-slate-700 dark:text-white"
          aria-label="Open navigation menu"
        >
          ☰
        </button>

        <div className="w-full">
          <input
            type="text"
            placeholder="🔍 Search sessions, tracks, laps..."
            className="w-full bg-slate-50 dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-xl px-3.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Pravá část: Profil, ThemeToggle a Odhlášení */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {user && (
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-emerald-500 transition shadow-2xs"
          >
            <span>👤</span>
            <span className="hidden sm:inline">
              {profile?.nickname || profile?.first_name || user.email?.split('@')[0]}
            </span>
          </button>
        )}

        <ThemeToggle currentUser={user} />

        {user && onSignOut && (
          <button
            onClick={onSignOut}
            className="py-1.5 px-3 rounded-xl bg-slate-100 hover:bg-rose-500 hover:text-white dark:bg-slate-800 dark:hover:bg-rose-600 text-slate-700 dark:text-slate-300 text-xs font-bold transition shadow-2xs"
            title="Sign Out"
          >
            Log Out
          </button>
        )}
      </div>
    </header>
  )
}