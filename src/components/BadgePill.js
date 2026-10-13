import Icon, { BADGE_ICONS } from './ActivityIcons'

const TONES = {
  gold: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40',
  green: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
  rose: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40',
  blue: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/40',
  purple: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/40',
}

export default function BadgePill({ badge }) {
  return (
    <span
      title={badge.detail}
      className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-tight px-2 py-0.5 rounded-full border ${TONES[badge.tone] || TONES.blue}`}
    >
      <Icon name={BADGE_ICONS[badge.kind] || 'trophy'} size={11} />
      {badge.label}
    </span>
  )
}
