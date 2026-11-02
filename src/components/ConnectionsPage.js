'use client'

import Link from 'next/link'
import { RIDE_SOURCES } from '../lib/rideSources'
import { IntervalsCard, StravaCard, WahooCard } from './ConnectionsPanel'

const CARD = 'rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 p-3 space-y-2'
const BADGE = 'text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-400'
const LINK = 'text-[11px] font-bold uppercase text-emerald-600 dark:text-brand-neon hover:underline'

function SourceHeader({ source, badge }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{source.name}</span>
        {badge && <span className={BADGE}>{badge}</span>}
      </div>
      <p className="text-[11px] text-slate-400">{source.blurb}</p>
    </>
  )
}

function ComingSoonCard({ source }) {
  return (
    <div className={CARD}>
      <SourceHeader source={source} badge="Coming soon" />
    </div>
  )
}

function ImportCard({ source }) {
  return (
    <div className={CARD}>
      <SourceHeader source={source} badge="File import" />
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href={source.href} className={LINK}>{source.hrefLabel}</Link>
        <Link href="/" className={LINK}>Import history (Add session)</Link>
      </div>
    </div>
  )
}

// To ship Garmin: add `garmin: GarminCard` here and set its status to 'available' in rideSources.js.
const CARDS = {
  wahoo: WahooCard,
  intervals: IntervalsCard,
  strava: StravaCard,
}

function SourceCard({ source, userId }) {
  const Card = CARDS[source.id]
  if (source.status === 'coming-soon' || (!Card && source.kind === 'connect')) return <ComingSoonCard source={source} />
  if (source.kind === 'import') return <ImportCard source={source} />
  return <Card userId={userId} />
}

export default function ConnectionsPage({ userId }) {
  return (
    <div className="space-y-3">
      {RIDE_SOURCES.map((source) => (
        <SourceCard key={source.id} source={source} userId={userId} />
      ))}
    </div>
  )
}
