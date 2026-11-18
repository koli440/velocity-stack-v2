'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Icon from './Icon'
import { parseCoachPath } from '../lib/coachContext'
import { totalUnread } from '../lib/coachChat'
import { badgeLabel } from '../lib/navState'
import useNavThreads from './useNavThreads'

// Fixed bottom bar below lg: Home, Calendar, Messages (only with conversations) and Menu (opens the drawer).
// Hidden for logged-out visitors and inside an athlete context (see showsBottomNav).
export function showsBottomNav(signedIn, pathname) {
  return !!signedIn && !parseCoachPath(pathname).riderId
}

export const BOTTOM_NAV_PAD = 'pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0'

export default function BottomNav({ signedIn, onOpenMenu }) {
  const pathname = usePathname() || ''
  const threads = useNavThreads(signedIn)
  if (!showsBottomNav(signedIn, pathname)) return null
  const unread = badgeLabel(totalUnread(threads))
  const tab = 'relative flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500'
  const tone = (active) => (active ? 'text-emerald-600 dark:text-brand-neon font-bold' : 'text-slate-500 dark:text-slate-400')
  const link = (href, label, icon, active, badge) => (
    <Link href={href} aria-current={active ? 'page' : undefined} className={`${tab} ${tone(active)}`}>
      <span className="relative">
        <Icon name={icon} size={22} />
        {badge && (
          <span data-testid="bottom-nav-unread" aria-label={`${badge} unread`} className="absolute -top-1.5 -right-3 rounded-full bg-orange-500 text-white text-[10px] font-bold px-1.5 leading-4">
            {badge}
          </span>
        )}
      </span>
      {label}
    </Link>
  )
  return (
    <nav
      aria-label="Quick navigation"
      data-testid="bottom-nav"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 flex border-t border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard glass-nav pb-[env(safe-area-inset-bottom)] print:hidden"
    >
      {link('/', 'Home', 'home', pathname === '/')}
      {link('/calendar', 'Calendar', 'calendar', pathname === '/calendar' || pathname.startsWith('/calendar/'))}
      {threads.length > 0 && link('/chat', 'Messages', 'chat', pathname === '/chat' || pathname.startsWith('/chat/'), unread)}
      <button type="button" onClick={onOpenMenu} aria-label="Open navigation menu" className={`${tab} ${tone(false)}`}>
        <Icon name="menu" size={22} />
        Menu
      </button>
    </nav>
  )
}
