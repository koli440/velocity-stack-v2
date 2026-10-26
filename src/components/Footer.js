'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Icon from './Icon'
import { parseCoachPath, chromeVisibility } from '../lib/coachContext'

export default function Footer() {
  const showLinks = chromeVisibility(parseCoachPath(usePathname()).riderId).footerLinks
  return (
    <footer className="mt-auto glass-nav border-t border-slate-200 dark:border-surface-darkBorder bg-white/50 dark:bg-surface-darkCard/40 backdrop-blur-xs py-4 px-6 text-xs text-slate-500 dark:text-slate-400">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-slate-800 dark:text-slate-200">
            Velocity<span className="text-emerald-500 dark:text-brand-neon">Stack</span>
          </span>
          <span>•</span>
          <span>Dedicated Velodrome Telemetry</span>
        </div>

        <div className="flex items-center gap-4">
          {showLinks && <>
          <Link
            href="/about"
            className="hover:text-slate-900 dark:hover:text-white transition"
          >
            About & Docs
          </Link>

          <Link
            href="/feedback"
            className="hover:text-slate-900 dark:hover:text-white transition"
          >
            <Icon name="bulb" /> Feedback
          </Link>

          <Link
            href="/report-bug"
            className="flex items-center gap-1.5 text-rose-500/90 dark:text-rose-400 hover:text-rose-600 font-semibold transition"
          >
            <Icon name="bug" /> Report a Bug
          </Link>
          </>}

          <Link href="/track" className="hover:text-slate-900 dark:hover:text-white transition">
            For track riders
          </Link>

          <Link href="/terms" className="hover:text-slate-900 dark:hover:text-white transition">
            Terms
          </Link>

          <Link href="/privacy" className="hover:text-slate-900 dark:hover:text-white transition">
            Privacy
          </Link>

          <span className="text-slate-400 font-mono text-[10px]">v0.4.2-beta</span>
        </div>
      </div>
    </footer>
  )
}