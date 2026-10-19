import { calendarTileParts, fullDateTime } from '../lib/dateFormat'

// Translucent "glass" calendar tile: big day number over a small uppercase month.
export default function CalendarTile({ date, large = false, className = '' }) {
  const parts = calendarTileParts(date)
  if (!parts) return null
  return (
    <div
      title={fullDateTime(date)}
      className={`${large ? 'px-3.5 py-2 min-w-[64px]' : 'px-2.5 py-1 min-w-[44px]'} rounded-xl bg-slate-950/55 backdrop-blur-sm border border-white/15 text-white text-center leading-none ${className}`}
    >
      <b className={`block font-black tracking-tight ${large ? 'text-3xl' : 'text-xl'}`}>{parts.day}</b>
      <span className={`block mt-0.5 font-bold uppercase tracking-widest ${large ? 'text-[11px]' : 'text-[9px]'}`}>{parts.month}</span>
    </div>
  )
}
