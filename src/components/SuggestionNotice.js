'use client'

import { SUGGESTION_NOTICE } from '../lib/suggestions'

// Drop into any suggestion form to tell users changes are moderated.
export default function SuggestionNotice({ className = '' }) {
  return (
    <p className={`text-xs text-slate-500 dark:text-slate-400 ${className}`}>{SUGGESTION_NOTICE}</p>
  )
}
