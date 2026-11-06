'use client'

import Icon from './Icon'
import { REACTION_ICON, reactionButtonLabel, reactionCountLabel } from '../lib/activityReactions'

// "Respect" chip. Interactive when the viewer may react; otherwise a read-only count (hidden at zero).
export default function ReactionButton({ count = 0, reacted = false, canReact = false, busy = false, onToggle, size = 'sm' }) {
  const pad = size === 'md' ? 'px-3 py-1.5 text-xs' : 'px-2 py-0.5 text-[11px]'
  const base = `relative z-10 shrink-0 inline-flex items-center gap-1 font-bold rounded-full ${pad}`
  if (!canReact) {
    if (!count) return null
    return (
      <span data-testid="reaction-count" aria-label={reactionCountLabel(count)} title={reactionCountLabel(count)} className={`${base} bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300`}>
        <Icon name={REACTION_ICON} size={size === 'md' ? 14 : 11} /> {count}
      </span>
    )
  }
  return (
    <button
      type="button"
      data-testid="reaction-button"
      aria-pressed={reacted}
      aria-label={reactionButtonLabel(reacted)}
      title={reactionButtonLabel(reacted)}
      disabled={busy}
      onClick={onToggle}
      className={`${base} transition disabled:opacity-60 ${
        reacted
          ? 'bg-orange-500/15 text-orange-500 border border-orange-500/40'
          : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-orange-500 border border-transparent'
      }`}
    >
      <Icon name={REACTION_ICON} size={size === 'md' ? 14 : 11} /> {size === 'md' ? 'Respect' : null}
      {count > 0 ? <span>{count}</span> : null}
    </button>
  )
}
