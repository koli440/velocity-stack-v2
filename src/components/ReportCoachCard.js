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

  if (state === 'done') return <p className="text-xs text-slate-500">Thanks, we will take a look.</p>
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-xs text-slate-500 underline">Report this page</button>
  }
  return (
    <form onSubmit={send} className="space-y-2">
      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200" htmlFor="report-reason">What is wrong with this page?</label>
      <textarea id="report-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent p-2 text-sm" />
      {state === 'error' && <p role="alert" className="text-xs text-red-600">Could not send. Sign in and try again.</p>}
      <button disabled={!reason.trim() || state === 'sending'} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50">Send report</button>
    </form>
  )
}
