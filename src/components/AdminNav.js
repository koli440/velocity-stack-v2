'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const ADMIN_LINKS = [
  ['/admin', 'Dashboard'],
  ['/admin/suggestions', 'Suggestions'],
  ['/admin/exercises', 'Exercise mapping'],
  ['/admin/comment-reports', 'Reported comments'],
  ['/admin/template-reruns', 'Template re-run'],
  ['/admin/partner-apps', 'Partner apps'],
]

// Pill-style admin navigation; scrolls horizontally on narrow screens.
export default function AdminNav() {
  const pathname = usePathname() || ''
  return (
    <nav aria-label="Admin pages" className="max-w-6xl mx-auto px-4 sm:px-6 pt-4">
      <ul className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {ADMIN_LINKS.map(([href, label]) => {
          const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center min-h-[44px] lg:min-h-[36px] px-4 rounded-full text-sm font-bold border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                  active
                    ? 'bg-orange-500 border-orange-500 text-white shadow-md shadow-orange-500/30'
                    : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400'
                }`}
              >
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
