'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ThemeToggle from './ThemeToggle'
import Avatar from './Avatar'
import Icon from './Icon'
import NotificationBell from './NotificationBell'
import AddSessionModal from './AddSessionModal'
import { OPEN_ADD_SESSION_EVENT } from '../lib/navigation'

export default function TopNav({
  user,
  profile,
  onOpenMobileMenu,
  onSignOut,
  tracks = [],
}) {
  const router = useRouter()
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    const open = () => setAddOpen(true)
    window.addEventListener(OPEN_ADD_SESSION_EVENT, open)
    return () => window.removeEventListener(OPEN_ADD_SESSION_EVENT, open)
  }, [])

  const displayName =
    profile?.nickname || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email?.split('@')[0]

  return (
    <>
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 sm:px-8 py-3.5 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-slate-200 dark:border-surface-darkBorder">
      {/* Left side: mobile hamburger + search */}
      <div className="flex items-center gap-3 w-full max-w-md">
        <button
          onClick={onOpenMobileMenu}
          className="md:hidden p-2 rounded-xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard text-slate-700 dark:text-white"
          aria-label="Open navigation menu"
        >
          <Icon name="menu" size={20} />
        </button>

        <div className="w-full relative">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search sessions, tracks, laps..."
            className="w-full bg-slate-50 dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-xl pl-9 pr-3.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Right side: Profile, ThemeToggle and Sign Out */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {user && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            aria-label="Add or sync sessions"
            title="Add or sync sessions"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 text-xs font-bold transition shadow-2xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <span aria-hidden="true">＋</span>
            <span className="hidden sm:inline">Add / Sync</span>
          </button>
        )}

        {user && (
          <div className="flex items-center gap-1">
          <button
            onClick={() => router.push('/settings')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-emerald-500 transition shadow-2xs"
          >
            <Avatar url={profile?.avatar_url} name={displayName} size="w-6 h-6" textSize="text-[10px]" />
            <span className="hidden sm:inline">{displayName}</span>
          </button>
          <NotificationBell userId={user.id} />
          </div>
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
    <AddSessionModal isOpen={addOpen} onClose={() => setAddOpen(false)} user={user} tracks={tracks} />
    </>
  )
}