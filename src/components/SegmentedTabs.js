'use client'

// Shared segmented control: one opaque track, active tab is a raised orange pill.
// The track is deliberately NOT glass so it stays readable when glass mode is on.
export default function SegmentedTabs({ tabs, value, onChange, label, className = '' }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`inline-flex flex-wrap gap-1 p-1 rounded-2xl bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 ${className}`}
    >
      {tabs.map(([key, text]) => {
        const active = value === key
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-200 dark:focus-visible:ring-offset-slate-800 ${
              active
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/30'
                : 'text-slate-700 dark:text-slate-200 hover:bg-white/70 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}
