'use client'

import { useState } from 'react'
import Portal from './Portal'
import useScrollLock from './useScrollLock'
import { supabase } from '../lib/supabase'
import { adminBtn, adminInput } from './admin/AdminUi'
import { endCoachingCopy, confirmPhrase, endConfirmed } from '../lib/endCoaching'
import { fetchCoachNotes, notesToText } from '../lib/coachNotes'

// Mandatory confirmation before ending an active coaching relationship; ending removes data, so there is no one-click path.
// The coach can download their notes first (riderId set). `onConfirm` performs the end.
export default function EndCoachingDialog({ role, name, riderId, onConfirm, onClose }) {
  useScrollLock()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const copy = endCoachingCopy(role, name)
  const ok = endConfirmed(typed, name)

  const exportNotes = async () => {
    setMsg(null)
    const res = await fetchCoachNotes(supabase, riderId)
    if (res.error) return setMsg('Could not load your notes. Try again before ending.')
    const blob = new Blob([notesToText(res.notes, name)], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'coach-notes.txt'
    a.click()
    URL.revokeObjectURL(a.href)
    setMsg(`Exported ${res.notes.length} note${res.notes.length === 1 ? '' : 's'}.`)
  }

  const confirm = async () => {
    if (!ok) return
    setBusy(true)
    await onConfirm()
    setBusy(false)
    onClose()
  }

  const list = (items) => <ul className="list-disc pl-5 space-y-1">{items.map((t) => <li key={t}>{t}</li>)}</ul>

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto" role="presentation" onClick={onClose}>
        <div role="dialog" aria-modal="true" aria-labelledby="end-coaching-title" data-testid="end-coaching-dialog" className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 space-y-3 text-sm text-slate-800 dark:text-slate-200" onClick={(e) => e.stopPropagation()}>
          <h2 id="end-coaching-title" className="text-base font-black text-slate-900 dark:text-white">{copy.title}</h2>
          <section><h3 className="font-bold text-rose-700 dark:text-rose-300">What is deleted</h3>{list(copy.deletes)}</section>
          <section><h3 className="font-bold">What {role === 'coach' ? 'the athlete keeps' : 'you keep'}</h3>{list(copy.keeps)}</section>
          <section><h3 className="font-bold">What {role === 'coach' ? 'you lose' : 'the coach loses'}</h3>{list(copy.loses)}</section>
          {role === 'coach' && riderId && (
            <div>
              <button type="button" className={adminBtn.secondary} onClick={exportNotes}>Download my notes (.txt)</button>
              {msg && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{msg}</p>}
            </div>
          )}
          <label className="block font-semibold space-y-1">
            <span>Type <span className="font-black">{confirmPhrase(name)}</span> to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className={adminInput} autoComplete="off" data-testid="end-coaching-input" />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={adminBtn.secondary} onClick={onClose}>Keep coaching</button>
            <button type="button" disabled={!ok || busy} className="inline-flex items-center justify-center min-h-[44px] lg:min-h-[36px] px-3 rounded-xl text-xs font-bold bg-rose-600 text-white disabled:opacity-40" onClick={confirm} data-testid="end-coaching-confirm">End coaching</button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
