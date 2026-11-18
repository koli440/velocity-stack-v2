'use client'

// Shared segmented control: one opaque track, active tab is a raised orange pill.
// The track is deliberately NOT glass so it stays readable when glass mode is on.
// Accessible: roving tabindex with arrow/Home/End keys; tabs are 44px high below sm (touch) and wrap on narrow screens.
export default function SegmentedTabs({ tabs, value, onChange, label, className = '' }) {
  const onKeyDown = (e) => {
    const keys = tabs.map(([k]) => k)
    const at = keys.indexOf(value)
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % keys.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + keys.length) % keys.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = keys.length - 1
    if (next === null) return
    e.preventDefault()
    onChange(keys[next])
    e.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`inline-flex flex-wrap max-w-full gap-1 p-1 rounded-2xl bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 ${className}`}
    >
      {tabs.map(([key, text]) => {
        const active = value === key
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(key)}
            className={`min-h-[44px] sm:min-h-0 px-3.5 py-1.5 rounded-xl text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-200 dark:focus-visible:ring-offset-slate-800 ${
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
