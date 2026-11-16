'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { reportCoachCard } from '../lib/coachCard'

export default function ReportCoachCard({ slug }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [state, setState] = useState('idle')

  const send = async (e) => {
    e.preventDefault()
    setState('sending')
    const { error } = await reportCoachCard(supabase, slug, reason.trim())
    setState(error ? 'error' : 'done')
  }

  if (state === 'done') return <p className="text-sm text-slate-600 dark:text-slate-300">Thanks, we will take a look.</p>
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="min-h-[44px] text-sm font-semibold text-slate-600 dark:text-slate-300 underline">Report this page</button>
  }
  return (
    <form onSubmit={send} className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-4 space-y-3">
      <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100" htmlFor="report-reason">What is wrong with this page?</label>
      <textarea id="report-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="w-full px-3 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
      {state === 'error' && <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">Could not send. Sign in and try again.</p>}
      <button disabled={!reason.trim() || state === 'sending'} className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl text-sm font-bold bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed">{state === 'sending' ? 'Sending…' : 'Send report'}</button>
    </form>
  )
}
