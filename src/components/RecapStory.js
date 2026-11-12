'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Avatar from './Avatar'
import { cardTheme } from '../lib/recap'

// Swipeable story cards (CSS scroll-snap: touch swipe, trackpad, arrow keys, dots and prev/next buttons).
// `children` is an optional last slide (share panel for the owner, call to action for visitors).
export default function RecapStory({ cards, children, avatarUrl = null, name = '' }) {
  const track = useRef(null)
  const [index, setIndex] = useState(0)
  const extra = children ? 1 : 0
  const total = cards.length + extra

  const goTo = useCallback((i) => {
    const el = track.current
    if (!el) return
    const next = Math.max(0, Math.min(total - 1, i))
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
  }, [total])

  useEffect(() => {
    const el = track.current
    if (!el) return undefined
    const onScroll = () => setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index + 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1) }
  }

  return (
    <section aria-roledescription="carousel" aria-label="Season recap" className="max-w-md mx-auto" onKeyDown={onKeyDown}>
      <div
        ref={track}
        tabIndex={0}
        className="flex overflow-x-auto snap-x snap-mandatory rounded-3xl scroll-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {cards.map((c, i) => {
          const theme = cardTheme(c.id)
          return (
            <article
              key={c.id}
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${total}: ${c.title}`}
              className={`relative overflow-hidden snap-center shrink-0 w-full min-h-[28rem] flex flex-col justify-center gap-4 p-8 bg-gradient-to-br ${theme.gradient} text-white`}
            >
              <span aria-hidden="true" className="pointer-events-none absolute -right-4 -top-6 text-[9rem] leading-none opacity-15 select-none motion-safe:animate-pulse">{theme.icon}</span>
              {c.id === 'intro' && (
                <Avatar url={avatarUrl} name={name} size="w-24 h-24" textSize="text-3xl" className="ring-4 ring-brand-neon shadow-xl" />
              )}
              <p className="relative text-xs font-black uppercase tracking-widest text-brand-neon">{c.title}</p>
              {c.big && <p className="relative text-5xl font-black leading-tight break-words bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">{c.big}</p>}
              <div className="relative space-y-1 text-lg text-slate-200">
                {c.lines.map((l) => <p key={l}>{l}</p>)}
              </div>
              {c.gauge !== undefined && (
                <div className="relative" aria-hidden="true">
                  <div className="h-3 rounded-full bg-white/15 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-rose-400" style={{ width: `${Math.round(c.gauge * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-300">Best average vs. peak</p>
                </div>
              )}
              {c.streak && (
                <div className="relative flex flex-wrap gap-1" aria-hidden="true">
                  {Array.from({ length: c.streak }, (_, d) => (
                    <span key={d} className="w-4 h-4 rounded-full bg-orange-400" style={{ opacity: 0.4 + 0.6 * ((d + 1) / c.streak) }} />
                  ))}
                </div>
              )}
              {c.trophies && (
                <p className="relative text-3xl" aria-hidden="true">{'🏆'.repeat(c.trophies)}</p>
              )}
              {c.bars && c.bars.length > 0 && (
                <div className="relative flex items-end gap-1 h-28" aria-hidden="true">
                  {c.bars.map((b) => (
                    <div key={b.month} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                      <div
                        className={`w-full rounded-t ${b.peak ? 'bg-brand-neon' : 'bg-white/40'}`}
                        style={{ height: `${Math.max(3, b.height * 100)}%` }}
                      />
                      <span className="text-[10px] text-slate-300">{b.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          )
        })}
        {children && (
          <article
            aria-roledescription="slide"
            aria-label={`${total} of ${total}`}
            className="snap-center shrink-0 w-full min-h-[28rem] flex flex-col justify-center gap-4 p-8 bg-gradient-to-br from-slate-950 to-slate-800 text-white"
          >
            {children}
          </article>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-600 disabled:opacity-40">
          Back
        </button>
        <div className="flex gap-1.5" role="group" aria-label="Slides">
          {Array.from({ length: total }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === index}
              onClick={() => goTo(i)}
              className={`h-2 rounded-full transition-all ${i === index ? 'w-5 bg-emerald-500' : 'w-2 bg-slate-300 dark:bg-slate-600'}`}
            />
          ))}
        </div>
        <button type="button" onClick={() => goTo(index + 1)} disabled={index >= total - 1} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-600 disabled:opacity-40">
          Next
        </button>
      </div>
    </section>
  )
}
