import { SUPPORT_URL, SUPPORT_LABEL } from '../lib/support'

// Yellow stays the same in light and dark themes (brand colour of Buy Me a Coffee).
export default function SupportButton({ className = '' }) {
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-[#FFDD00] text-black hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${className}`}
    >
      <span aria-hidden="true">☕</span> {SUPPORT_LABEL}
    </a>
  )
}
