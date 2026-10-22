// Shared "Race" badge (text + trophy + amber accent, never colour-only).
export default function RaceBadge({ testId, className = '', size = 'sm' }) {
  const text = size === 'xs' ? 'text-[9px] px-1' : 'text-[10px] px-1.5 py-0.5'
  return (
    <span
      data-testid={testId}
      aria-label="Race"
      className={`inline-block shrink-0 rounded font-black uppercase tracking-wide bg-amber-400/25 text-amber-800 dark:text-amber-200 border border-amber-500/60 ${text} ${className}`}
    >
      <span aria-hidden>🏆 </span>Race
    </span>
  )
}
