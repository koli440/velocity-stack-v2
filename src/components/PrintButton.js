'use client'

import Icon from './Icon'

export default function PrintButton({ label = 'Print / Save PDF' }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      data-testid="print-report"
      className="print:hidden inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-bold border bg-orange-500 border-orange-500 text-white hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
    >
      <Icon name="save" /> {label}
    </button>
  )
}
