'use client'

import Icon from './Icon'
import { respectLevel } from '../lib/respectLevel'
import { REACTION_ICON, reactionButtonLabel, reactionCountLabel } from '../lib/activityReactions'

// "Respect" chip. Interactive when the viewer may react; otherwise a read-only count (hidden at zero).
export default function ReactionButton({ count = 0, reacted = false, canReact = false, busy = false, onToggle, size = 'sm' }) {
  const tile = size === 'md' || size === 'card'
  if (tile) return <RespectTile large={size === 'md'} {...{ count, reacted, canReact, busy, onToggle }} />
  if (!canReact && !count) return null
  const tone = reacted
    ? 'bg-orange-500/15 text-orange-500 border border-orange-500/40'
    : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-orange-500 border border-transparent'
  const cls = `relative z-10 shrink-0 inline-flex items-center justify-center gap-1.5 font-bold rounded-full px-2 py-0.5 text-[11px] ${canReact ? `transition disabled:opacity-60 ${tone}` : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300'}`
  if (!canReact) {
    return (
      <span data-testid="reaction-count" aria-label={reactionCountLabel(count)} title={reactionCountLabel(count)} className={cls}>
        <Icon name={REACTION_ICON} size={11} /> {count}
      </span>
    )
  }
  return (
    <button type="button" data-testid="reaction-button" aria-pressed={reacted} aria-label={reactionButtonLabel(reacted)} title={reactionButtonLabel(reacted)} disabled={busy} onClick={onToggle} className={cls}>
      <Icon name={REACTION_ICON} size={11} />
      {count > 0 ? <span>{count}</span> : null}
    </button>
  )
}

// Glass tile that mirrors CalendarTile: number on top, "Respect" label, then the level word.
function RespectTile({ count, reacted, canReact, busy, onToggle, large }) {
  if (!canReact && !count) return null
  const level = respectLevel(count)
  const label = canReact ? reactionButtonLabel(reacted) : reactionCountLabel(count)
  const tone = reacted
    ? `${large ? 'bg-orange-600 dark:bg-orange-500/30' : 'bg-orange-500/40'} border-orange-400/70`
    : canReact
      ? `${large ? 'bg-slate-900 dark:bg-white/10' : 'bg-slate-950/55'} border-orange-400/60 hover:bg-orange-500/25`
      : `${large ? 'bg-slate-900 dark:bg-white/10' : 'bg-slate-950/55'} border-white/15`
  const cls = `relative z-10 shrink-0 self-stretch flex flex-col items-center justify-center rounded-xl overflow-hidden backdrop-blur-sm border text-white text-center leading-none ${
    large ? 'px-3 py-2 min-w-[72px]' : 'px-1.5 py-1 min-w-[56px] gap-px'
  } ${tone}`
  const inner = (
    <>
      <b className={`flex items-center justify-center gap-1 font-black tracking-tight ${large ? 'text-3xl' : 'text-lg'}`}>
        {reacted ? <Icon name="check" size={large ? 20 : 14} /> : <Icon name={REACTION_ICON} size={large ? 20 : 14} />}
        {count}
      </b>
      <span className={`block ${large ? 'mt-0.5 text-[11px]' : 'text-[9px]'} font-bold uppercase tracking-widest`}>Respect</span>
      {level && (
        <span data-testid="respect-level" className={`block whitespace-nowrap ${large ? 'mt-0.5 text-[10px]' : 'text-[8px]'} font-black uppercase tracking-wide text-orange-300`}>
          {level}
        </span>
      )}
    </>
  )
  if (!canReact) {
    return (
      <div data-testid="reaction-count" aria-label={label} title={level ? `${label} - ${level}` : label} className={cls}>
        {inner}
      </div>
    )
  }
  return (
    <button
      type="button"
      data-testid="reaction-button"
      aria-pressed={reacted}
      aria-label={label}
      title={level ? `${label} - ${level}` : label}
      disabled={busy}
      onClick={onToggle}
      className={`${cls} transition disabled:opacity-60 motion-safe:active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500`}
    >
      {inner}
    </button>
  )
}
