'use client'

import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-slate-200 dark:border-surface-darkBorder bg-white/50 dark:bg-surface-darkCard/40 backdrop-blur-xs py-4 px-6 text-xs text-slate-500 dark:text-slate-400">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-slate-800 dark:text-slate-200">
            Velocity<span className="text-emerald-500 dark:text-brand-neon">Stack</span>
          </span>
          <span>•</span>
          <span>Dedicated Velodrome Telemetry</span>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/about"
            className="hover:text-slate-900 dark:hover:text-white transition"
          >
            About & Docs
          </Link>

          <a
            href="https://github.com/your-repo/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-rose-500/90 dark:text-rose-400 hover:text-rose-600 font-semibold transition"
          >
            <span>🐞</span> Report a Bug
          </a>

          <span className="text-slate-400 font-mono text-[10px]">v0.4.2-beta</span>
        </div>
      </div>
    </footer>
  )
}