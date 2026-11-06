'use client'

import Icon from './Icon'
import { REACTION_ICON, reactionButtonLabel, reactionCountLabel } from '../lib/activityReactions'

// "Respect" chip. Interactive when the viewer may react; otherwise a read-only count (hidden at zero).
export default function ReactionButton({ count = 0, reacted = false, canReact = false, busy = false, onToggle, size = 'sm' }) {
  const md = size === 'md'
  const card = size === 'card'
  const rich = md || card
  const base = `relative z-10 shrink-0 inline-flex items-center justify-center gap-1.5 font-bold rounded-full ${
    md ? 'px-5 py-2.5 min-h-[44px] text-sm' : card ? 'px-3 py-1.5 min-h-[36px] sm:min-h-[40px] text-xs sm:text-sm' : 'px-2 py-0.5 text-[11px]'
  }`
  const iconSize = md ? 18 : card ? 16 : 11
  if (!canReact) {
    if (!count) return null
    return (
      <span
        data-testid="reaction-count"
        aria-label={reactionCountLabel(count)}
        title={reactionCountLabel(count)}
        className={`${base} ${
          rich
            ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/40'
            : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300'
        }`}
      >
        <Icon name={REACTION_ICON} size={iconSize} /> {md ? `${count} ${count === 1 ? 'respect' : 'respects'}` : count}
      </span>
    )
  }
  const tone = rich
    ? reacted
      ? 'bg-orange-500/20 text-orange-700 dark:text-orange-300 border-2 border-orange-500 hover:bg-orange-500/30 shadow-sm'
      : 'bg-orange-500 hover:bg-orange-600 text-white border-2 border-orange-500 hover:border-orange-600 shadow-md shadow-orange-500/30'
    : reacted
      ? 'bg-orange-500/15 text-orange-500 border border-orange-500/40'
      : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-orange-500 border border-transparent'
  const press = rich ? 'motion-safe:active:scale-95 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2' : ''
  return (
    <button
      type="button"
      data-testid="reaction-button"
      aria-pressed={reacted}
      aria-label={reactionButtonLabel(reacted)}
      title={reactionButtonLabel(reacted)}
      disabled={busy}
      onClick={onToggle}
      className={`${base} transition disabled:opacity-60 ${press} ${tone}`}
    >
      <Icon name={reacted && rich ? 'check' : REACTION_ICON} size={iconSize} />
      {md ? (reacted ? 'Respected' : 'Respect') : card ? <span className="hidden sm:inline">{reacted ? 'Respected' : 'Respect'}</span> : null}
      {count > 0 ? <span>{count}</span> : null}
    </button>
  )
}
