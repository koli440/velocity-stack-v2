export default function BotBadge({ className = '' }) {
  return (
    <span
      title="Synthetic rider: its rides are generated automatically"
      className={`inline-flex items-center text-[9px] font-black uppercase tracking-tight px-1.5 py-0.5 rounded border bg-slate-500/15 text-slate-500 dark:text-slate-300 border-slate-500/40 ${className}`}
    >
      bot
    </span>
  )
}
