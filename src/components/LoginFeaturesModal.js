'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

/* ---------- Static visuals (no data/auth needed) ---------- */

function Stats({ items }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {items.map(([value, label]) => (
        <div
          key={label}
          className="flex-1 min-w-[90px] text-center border border-white/15 bg-white/10 rounded-xl p-2.5"
        >
          <b className="block text-xl text-emerald-300">{value}</b>
          <span className="text-[10px] uppercase text-white/70">{label}</span>
        </div>
      ))}
    </div>
  )
}

function TemplatesVisual() {
  return (
    <div>
      <pre className="font-mono text-xs leading-relaxed text-emerald-300 mb-3 whitespace-pre-wrap">
        {'6x\nwork 30sec ±10% @ >400W\nrecovery 90sec ±20% @ <150W'}
      </pre>
      <svg viewBox="0 0 400 110" width="100%" height="110" aria-hidden="true" className="text-emerald-300">
        {[40, 110, 180, 250, 320].map((x) => (
          <rect key={x} x={x} y="8" width="38" height="94" fill="currentColor" opacity="0.14" />
        ))}
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points="0,90 38,88 40,20 78,18 80,85 110,88 112,18 150,20 152,88 180,86 182,16 218,18 220,90 250,88 252,20 288,22 290,90 320,88 322,18 358,20 360,90 400,92"
        />
      </svg>
      <div className="text-[11px] text-white/70 mb-2.5">
        Template matched: 5 of 6 intervals detected
      </div>
      <Stats items={[['412 W', 'Avg work'], ['+18 W', 'vs last month'], ['5/6', 'Completed']]} />
    </div>
  )
}

function GearVisual() {
  return <Stats items={[['52×14', 'Gear'], ['100.3"', 'Inches'], ['3.71', 'Ratio'], ['57 km/h', '@105 rpm']]} />
}

function PursuitVisual() {
  return (
    <svg viewBox="0 0 400 90" width="100%" height="90" aria-hidden="true">
      <polyline
        fill="none"
        className="stroke-emerald-300"
        strokeWidth="2.5"
        points="0,60 60,45 120,40 180,38 240,40 300,36 360,28 400,22"
      />
      <polyline fill="none" className="stroke-white/40" strokeDasharray="4" points="0,40 400,40" />
    </svg>
  )
}

function VaultVisual() {
  return <Stats items={[['1:02.4', '500 m'], ['1:09.8', '1 km'], ['4:21.7', '4 km']]} />
}

function VelodromeVisual() {
  return (
    <svg viewBox="0 0 400 90" width="100%" height="90" aria-hidden="true">
      <rect x="60" y="15" width="280" height="60" rx="30" fill="none" className="stroke-emerald-300" strokeWidth="3" />
      <rect x="110" y="30" width="180" height="30" rx="15" fill="none" className="stroke-white/40" />
    </svg>
  )
}

function MoreVisual() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
      {MORE_TILES.map(([title, desc]) => (
        <div
          key={title}
          className="border border-white/15 rounded-2xl p-3.5 bg-white/10"
        >
          <b className="block text-[13px] mb-1 text-white">{title}</b>
          <span className="text-xs text-white/70">{desc}</span>
        </div>
      ))}
    </div>
  )
}

const MORE_TILES = [
  ['🌬 Aero Lab', 'Log and compare aero tests'],
  ['👥 Riders', 'Profiles, follow, feed'],
  ['🔄 Intervals.icu sync', 'Import automatically'],
  ['📁 FIT upload', 'Drop in files directly'],
  ['📈 Duration curves', 'Power across durations'],
  ['🗺 Activity maps', 'Routes, streams, privacy zones'],
]

/* ---------- Feature copy: edit here ---------- */

const FEATURES = [
  {
    name: 'Analysis Templates',
    starred: true,
    badge: 'Unique to Velocity Stack',
    heading: 'Define your own analysis. Track your own progress.',
    lead:
      'Athletes and coaches describe the exact intervals they care about in plain text. Velocity Stack finds them in every ride, validates the training against the plan, and compares each result to your previous ones.',
    Visual: TemplatesVisual,
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
    Visual: GearVisual,
    bullets: [
      ['Instant speed', 'at your target cadence'],
      ['Similar gears', 'suggestions within a tolerance'],
      ['Zero setup', 'no account data needed'],
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
    Visual: VaultVisual,
    bullets: [
      ['Bulk import', 'bring your history in at once'],
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
      ['Track details', 'length, surface and location'],
      ['Pursuit pacing', 'used by the strategist'],
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

const FOCUSABLE = 'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'

export default function LoginFeaturesModal({ open, onClose }) {
  const [active, setActive] = useState(0)
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement
    dialogRef.current?.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const els = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE))
      if (els.length === 0) return
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
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
  }, [open])

  if (!open) return null

  const feature = FEATURES[active]
  const { Visual } = feature

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-features-title"
        tabIndex={-1}
        className="bg-white/15 dark:bg-white/10 backdrop-blur-2xl backdrop-saturate-150 border border-white/20 rounded-3xl w-full max-w-4xl h-[min(640px,92vh)] flex flex-col overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_32px_rgba(0,0,0,0.35)] text-white focus:outline-none"
      >
        <div className="flex justify-between items-center px-6 py-4 border-b border-white/15">
          <h2 id="login-features-title" className="text-[15px] font-black uppercase text-white">
            Velocity<span className="text-emerald-300">Stack</span> — built for track cyclists
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-xl leading-none text-white/70 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 flex flex-col md:flex-row min-h-0">
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="Features"
            className="flex md:flex-col md:w-64 shrink-0 gap-1 p-2 md:p-3 overflow-x-auto md:overflow-y-auto border-b md:border-b-0 md:border-r border-white/15"
          >
            {FEATURES.map((f, i) => {
              const isActive = i === active
              return (
                <button
                  key={f.name}
                  type="button"
                  role="tab"
                  id={`login-feature-tab-${i}`}
                  aria-selected={isActive}
                  aria-controls="login-feature-panel"
                  onClick={() => setActive(i)}
                  className={`flex items-center gap-2.5 text-left whitespace-nowrap md:whitespace-normal md:w-full px-3 py-2.5 rounded-xl border text-[13px] font-bold transition ${
                    isActive
                      ? 'text-white bg-emerald-400/20 border-emerald-300/50'
                      : 'text-white/70 border-transparent hover:bg-white/10'
                  }`}
                >
                  <i
                    className={`not-italic w-[22px] h-[22px] shrink-0 rounded-full flex items-center justify-center text-[11px] ${
                      isActive
                        ? 'bg-emerald-400 text-slate-950'
                        : 'bg-white/20 text-white'
                    }`}
                  >
                    {i + 1}
                  </i>
                  {f.name}
                  {f.starred && (
                    <span aria-label="Unique to Velocity Stack" className="hidden md:inline ml-auto text-[11px] text-emerald-300">
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
            aria-labelledby={`login-feature-tab-${active}`}
            className="flex-1 p-5 md:p-7 overflow-y-auto"
          >
            {feature.badge && (
              <span className="inline-block mb-2.5 text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-400 text-slate-950">
                {feature.badge}
              </span>
            )}
            <h3 className="text-[22px] font-black text-white mb-1.5">{feature.heading}</h3>
            {feature.lead && (
              <p className="text-sm leading-relaxed text-white/80 mb-4">{feature.lead}</p>
            )}
            <div className="bg-white/10 border border-white/15 rounded-2xl p-4 mb-4">
              <Visual />
            </div>
            {feature.bullets.length > 0 && (
              <ul className="list-disc pl-5 text-[13px] leading-8 text-white/85">
                {feature.bullets.map(([title, text]) => (
                  <li key={title}>
                    <b>{title}</b> – {text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 px-6 py-3.5 border-t border-white/15">
          <span className="mr-auto text-xs text-white/70">
            Free for athletes. Everything lives behind your account.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 rounded-xl border border-white/20 text-white font-extrabold text-xs uppercase tracking-wider hover:bg-white/10 transition"
          >
            Sign in
          </button>
          <Link
            href="/register"
            className="px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs uppercase tracking-wider transition"
          >
            Create free account
          </Link>
        </div>
      </div>
    </div>
  )
}
