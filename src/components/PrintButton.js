'use client'

export default function PrintButton({ label = 'Print or save as PDF' }) {
  return (
    <button type="button" onClick={() => window.print()} className="print:hidden px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 text-slate-700">
      {label}
    </button>
  )
}
