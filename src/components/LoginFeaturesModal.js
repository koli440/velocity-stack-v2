'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

const NEON = '#39ff88'

const Stat = ({ value, label }) => (
  <div className="flex-1 min-w-[90px] text-center rounded-xl border border-slate-200 dark:border-slate-800 p-2.5">
    <b className="block text-xl text-emerald-600 dark:text-brand-neon">{value}</b>
    <span className="text-[10px] uppercase text-slate-500 dark:text-slate-400">{label}</span>
  </div>
)

const Stats = ({ items }) => (
  <div className="flex flex-wrap gap-2.5">
    {items.map(([value, label]) => (
      <Stat key={label} value={value} label={label} />
    ))}
  </div>
)

const TemplateVisual = () => (
  <div>
    <pre className="mb-3 text-xs leading-relaxed font-mono text-emerald-600 dark:text-brand-neon">
      {'6x\nwork 30sec ±10% @ >400W\nrecovery 90sec ±20% @ <150W'}
    </pre>
    <svg viewBox="0 0 400 110" width="100%" height="110" aria-hidden="true">
      {[40, 110, 180, 250, 320].map((x) => (
        <rect key={x} x={x} y="8" width="38" height="94" fill={NEON} fillOpacity="0.13" />
      ))}
      <polyline
        fill="none"
        stroke={NEON}
        strokeWidth="2"
        points="0,90 38,88 40,20 78,18 80,85 110,88 112,18 150,20 152,88 180,86 182,16 218,18 220,90 250,88 252,20 288,22 290,90 320,88 322,18 358,20 360,90 400,92"
      />
    </svg>
    <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2.5">
      Template matched: 5 of 6 intervals detected
    </p>
    <Stats items={[['412 W', 'Avg work'], ['+18 W', 'vs last month'], ['5/6', 'Completed']]} />
  </div>
)

const PursuitVisual = () => (
  <svg viewBox="0 0 400 90" width="100%" height="90" aria-hidden="true">
    <polyline fill="none" stroke={NEON} strokeWidth="2.5" points="0,60 60,45 120,40 180,38 240,40 300,36 360,28 400,22" />
    <polyline fill="none" stroke="#94a3b8" strokeDasharray="4" points="0,40 400,40" />
  </svg>
)

const VelodromeVisual = () => (
  <svg viewBox="0 0 400 90" width="100%" height="90" aria-hidden="true">
    <rect x="60" y="15" width="280" height="60" rx="30" fill="none" stroke={NEON} strokeWidth="3" />
    <rect x="110" y="30" width="180" height="30" rx="15" fill="none" stroke="#94a3b8" />
  </svg>
)

const MORE = [
  ['🌬 Aero Lab', 'Log and compare aero tests'],
  ['👥 Riders', 'Profiles, follow, feed'],
  ['🔄 Intervals.icu sync', 'Import automatically'],
  ['📁 FIT upload', 'Drop in files directly'],
  ['📈 Duration curves', 'Power across durations'],
  ['🗺 Activity maps', 'Routes, streams, privacy zones'],
]

const MoreVisual = () => (
  <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5">
    {MORE.map(([title, text]) => (
      <div key={title} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5">
        <b className="block text-[13px] mb-1">{title}</b>
        <span className="text-xs text-slate-500 dark:text-slate-400">{text}</span>
      </div>
    ))}
  </div>
)

// Edit feature copy here. Order = display order.
export const FEATURES = [
  {
    name: 'Analysis Templates',
    starred: true,
    badge: 'Unique to Velocity Stack',
    heading: 'Define your own analysis. Track your own progress.',
    lead:
      'Athletes and coaches describe the exact intervals they care about in plain text. Velocity Stack finds them in every ride, validates the training against the plan, and compares each result to your previous ones.',
    Visual: TemplateVisual,
    bullets: [
      ['Create your own', 'athletes and coaches write custom templates by time or distance, with power or speed bands'],
      ['Analyse & validate', 'check whether a session really delivered the planned work'],
      ['Compare & progress', 'track your own metrics and improvements against previous results'],
      ['Start fast', 'predefined track templates (bursts, flying sprint, sustained TT, standing start) are ready to use'],
    ],
  },
  {
    name: 'Gear Architect',
    heading: 'Pick the right gear before race day.',
    lead: 'Chainring, cog, cadence and wheel size in. Gear inches, ratio and speed out.',
    Visual: () => <Stats items={[['52×14', 'Gear'], ['100.3"', 'Inches'], ['3.71', 'Ratio'], ['57 km/h', '@105 rpm']]} />,
    bullets: [
      ['Instant speed', 'at your target cadence'],
      ['Similar gears', 'suggestions within a tolerance'],
      ['No setup', 'no account data needed'],
    ],
  },
  {
    name: 'Pursuit Strategist',
    heading: 'Pace the perfect pursuit.',
    lead: 'Choose a discipline and velodrome, set a goal time, get lap-by-lap targets.',
    Visual: PursuitVisual,
    bullets: [
      ['Pacing strategies', 'even, negative and positive splits'],
      ['Per-lap split table', 'know your target every lap'],
      ['Track-length aware', 'built on real velodrome data'],
    ],
  },
  {
    name: 'Personal Best Vault',
    heading: 'Every PR, in one place.',
    lead: 'Log and browse your bests by distance and discipline, each with its own detail page.',
    Visual: () => <Stats items={[['1:02.4', '500 m'], ['1:09.8', '1 km'], ['4:21.7', '4 km']]} />,
    bullets: [
      ['Bulk import', 'bring in your history quickly'],
      ['Context', 'attach track, gear and conditions'],
      ['Progress', 'watch your bests improve over time'],
    ],
  },
  {
    name: 'Velodromes',
    heading: 'Know the track.',
    lead: 'Browse the velodrome database and use track data across the strategist and analysis.',
    Visual: VelodromeVisual,
    bullets: [
      ['Details', 'length, surface and location'],
      ['Pursuit pacing', 'used by the Pursuit Strategist'],
      ['Searchable picker', 'find any track fast'],
    ],
  },
  {
    name: 'And more',
    heading: 'The rest of the toolbox.',
    lead: '',
    Visual: MoreVisual,
    bullets: [],
  },
]

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function LoginFeaturesModal({ open, onClose }) {
  const [current, setCurrent] = useState(0)
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement
    const dialog = dialogRef.current
    dialog?.querySelector('[data-autofocus]')?.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !dialog) return
      const nodes = dialog.querySelectorAll(FOCUSABLE)
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const feature = FEATURES[current]
  const { Visual } = feature

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-features-title"
        className="flex flex-col w-full max-w-4xl h-[min(640px,92vh)] overflow-hidden rounded-3xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard text-slate-900 dark:text-slate-100 shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-surface-darkBorder">
          <h2 id="login-features-title" className="text-[15px] font-black uppercase">
            Velocity<span className="text-emerald-500 dark:text-brand-neon">Stack</span> — built for track cyclists
          </h2>
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            aria-label="Close"
            className="text-xl leading-none text-slate-400 hover:text-slate-700 dark:hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          <div
            role="tablist"
            aria-label="Features"
            aria-orientation="vertical"
            className="flex md:flex-col shrink-0 gap-1 overflow-x-auto md:overflow-y-auto md:w-60 p-2 md:p-3 border-b md:border-b-0 md:border-r border-slate-200 dark:border-surface-darkBorder"
          >
            {FEATURES.map((f, i) => {
              const active = i === current
              return (
                <button
                  key={f.name}
                  type="button"
                  role="tab"
                  id={`login-feature-tab-${i}`}
                  aria-selected={active}
                  aria-controls="login-feature-panel"
                  onClick={() => setCurrent(i)}
                  className={`flex items-center gap-2.5 whitespace-nowrap md:whitespace-normal rounded-xl border px-3 py-2.5 text-left text-[13px] font-bold transition ${
                    active
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-slate-900 dark:text-white'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <span
                    className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] ${
                      active
                        ? 'bg-emerald-500 dark:bg-brand-neon text-white dark:text-slate-950'
                        : 'bg-slate-200 dark:bg-slate-800'
                    }`}
                  >
                    {i + 1}
                  </span>
                  {f.name}
                  {f.starred && (
                    <span className="ml-auto hidden md:inline text-[11px] text-emerald-500 dark:text-brand-neon" aria-label="Featured">
                      ★
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div
            role="tabpanel"
            id="login-feature-panel"
            aria-labelledby={`login-feature-tab-${current}`}
            className="flex-1 overflow-auto p-5 md:p-7"
          >
            {feature.badge && (
              <span className="inline-block mb-2.5 rounded-full bg-emerald-500 dark:bg-brand-neon px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white dark:text-slate-950">
                {feature.badge}
              </span>
            )}
            <h3 className="mb-1.5 text-xl md:text-[22px] font-black">{feature.heading}</h3>
            {feature.lead && (
              <p className="mb-4 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{feature.lead}</p>
            )}
            <div className="mb-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-surface-dark p-4">
              <Visual />
            </div>
            {feature.bullets.length > 0 && (
              <ul className="list-disc pl-5 space-y-1 text-[13px] leading-relaxed">
                {feature.bullets.map(([title, text]) => (
                  <li key={title}>
                    <b>{title}</b> – {text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 px-6 py-3.5 border-t border-slate-200 dark:border-surface-darkBorder">
          <span className="mr-auto text-xs text-slate-500 dark:text-slate-400">
            Free for athletes. Everything lives behind your account.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 dark:border-slate-700 px-5 py-3 text-xs font-extrabold uppercase tracking-wider hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Sign in
          </button>
          <Link
            href="/register"
            className="rounded-xl bg-emerald-500 dark:bg-brand-neon px-5 py-3 text-xs font-extrabold uppercase tracking-wider text-white dark:text-slate-950 hover:opacity-90"
          >
            Create free account
          </Link>
        </div>
      </div>
    </div>
  )
}
