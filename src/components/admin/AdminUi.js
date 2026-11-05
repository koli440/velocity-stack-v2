'use client'

// Shared building blocks for admin sub-pages: header, cards, buttons, badges, states.
import Link from 'next/link'
import Icon from '../Icon'

export const adminCard = 'glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-4 sm:p-5'
export const adminMuted = 'text-slate-600 dark:text-slate-300'
export const adminInput = 'w-full min-h-[44px] lg:min-h-[40px] px-3 rounded-xl text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-600 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

const btnBase = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-[40px] px-4 rounded-xl text-sm font-bold border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed'
export const adminBtn = {
  primary: `${btnBase} bg-orange-500 border-orange-500 text-white hover:bg-orange-600`,
  success: `${btnBase} bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700`,
  secondary: `${btnBase} bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 hover:border-orange-500`,
  danger: `${btnBase} bg-white dark:bg-slate-800 border-red-500 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40`,
}

const TONES = {
  good: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-700',
  warn: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-700',
  bad: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/50 dark:text-red-200 dark:border-red-700',
  neutral: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600',
}
const STATUS_TONE = {
  approved: 'good', done: 'good', resolved: 'good', pending: 'warn', open: 'warn',
  rejected: 'bad', failed: 'bad', suspended: 'bad', dismissed: 'neutral', skipped: 'neutral',
}

export function StatusBadge({ status, label }) {
  const tone = STATUS_TONE[status] || 'neutral'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-bold ${TONES[tone]}`}>
      {label || status}
    </span>
  )
}

export function AdminPage({ title, description, back = { href: '/admin', label: 'Admin dashboard' }, width = 'max-w-4xl', actions, children }) {
  return (
    <div className={`${width} mx-auto p-4 sm:p-6 space-y-5`}>
      <header className="space-y-2">
        {back && (
          <Link href={back.href} className="inline-flex items-center gap-1 min-h-[44px] lg:min-h-0 text-sm font-bold text-orange-700 dark:text-orange-400 hover:underline">
            <Icon name="chevronLeft" /> {back.label}
          </Link>
        )}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">{title}</h1>
          {actions}
        </div>
        {description && <p className={`text-sm ${adminMuted}`}>{description}</p>}
      </header>
      {children}
    </div>
  )
}

export function AdminMessage({ children }) {
  return <p className={`p-6 text-sm ${adminMuted}`}>{children}</p>
}

export function EmptyState({ children }) {
  return <div className={`${adminCard} text-sm ${adminMuted} text-center`}>{children}</div>
}

export function ErrorNote({ children }) {
  if (!children) return null
  return (
    <p role="alert" className="flex items-start gap-2 p-3 rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/40 text-sm font-semibold text-red-800 dark:text-red-200">
      <Icon name="alert" className="mt-0.5 shrink-0" /> <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}

export function StatusNote({ children }) {
  if (!children) return null
  return (
    <p role="status" className="flex items-start gap-2 p-3 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
      <Icon name="check" className="mt-0.5 shrink-0" /> <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}

export function Field({ label, children, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</div>
      <div className="text-sm text-slate-900 dark:text-white break-words">{children}</div>
    </div>
  )
}

export function CountTile({ label, value, tone }) {
  const c = { good: 'text-emerald-700 dark:text-emerald-400', warn: 'text-amber-700 dark:text-amber-400', bad: 'text-red-700 dark:text-red-400' }[tone] || 'text-slate-900 dark:text-white'
  return (
    <div className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 min-w-0">
      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</div>
      <div className={`text-2xl font-black leading-tight break-words ${c}`}>{value ?? '—'}</div>
    </div>
  )
}
