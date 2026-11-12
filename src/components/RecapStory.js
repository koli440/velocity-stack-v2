'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Swipeable story cards (CSS scroll-snap: touch swipe, trackpad, arrow keys, dots and prev/next buttons).
// `children` is an optional last slide (share panel for the owner, call to action for visitors).
export default function RecapStory({ cards, children }) {
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
        {cards.map((c, i) => (
          <article
            key={c.id}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${total}: ${c.title}`}
            className="snap-center shrink-0 w-full min-h-[28rem] flex flex-col justify-center gap-4 p-8 bg-gradient-to-br from-slate-950 to-slate-800 text-white"
          >
            <p className="text-xs font-black uppercase tracking-widest text-brand-neon">{c.title}</p>
            {c.big && <p className="text-5xl font-black leading-tight break-words">{c.big}</p>}
            <div className="space-y-1 text-lg text-slate-300">
              {c.lines.map((l) => <p key={l}>{l}</p>)}
            </div>
            {c.bars && (
              <div className="flex items-end gap-1 h-24" aria-hidden="true">
                {(() => {
                  const max = Math.max(...c.bars.map((b) => b.value), 1)
                  return c.bars.map((b, bi) => (
                    <div key={bi} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                      <div className="w-full rounded-t bg-brand-neon/80" style={{ height: `${Math.max(2, (b.value / max) * 100)}%` }} />
                      <span className="text-[10px] text-slate-400">{b.label}</span>
                    </div>
                  ))
                })()}
              </div>
            )}
          </article>
        ))}
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
