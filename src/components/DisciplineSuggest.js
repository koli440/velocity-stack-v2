'use client'

import { useState } from 'react'
import { getAuthHeader } from '../lib/supabase'
import SuggestionNotice from './SuggestionNotice'

const input =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500'

// Lets a user propose a new discipline; an admin approves it via the suggestions flow (#176).
export default function DisciplineSuggest({ categories = [] }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState(categories[0] || '')
  const [distanceM, setDistanceM] = useState('')
  const [flyingStart, setFlyingStart] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({
          entity_type: 'discipline',
          payload: {
            name: name.trim(),
            category: category.trim(),
            distance_m: Number(distanceM),
            flying_start: flyingStart,
          },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not submit suggestion')
      setMsg({ ok: true, text: 'Thanks! Your suggestion was sent for review.' })
      setName('')
      setDistanceM('')
      setOpen(false)
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
      >
        Missing a discipline? Suggest one
      </button>
      {msg && (
        <p className={`mt-1 text-xs ${msg.ok ? 'text-emerald-600' : 'text-rose-500'}`}>{msg.text}</p>
      )}
      {open && (
        <form onSubmit={submit} className="mt-2 space-y-2">
          <input className={input} placeholder="Name (e.g. 1km TT U17)" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className={input} placeholder="Category (e.g. Time Trial)" list="discipline-categories" value={category} onChange={(e) => setCategory(e.target.value)} required />
          <datalist id="discipline-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <input className={input} type="number" min="1" step="any" placeholder="Distance (m)" value={distanceM} onChange={(e) => setDistanceM(e.target.value)} required />
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={flyingStart} onChange={(e) => setFlyingStart(e.target.checked)} />
            Flying start
          </label>
          <SuggestionNotice />
          <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-bold disabled:opacity-50">
            {busy ? 'Sending…' : 'Submit suggestion'}
          </button>
        </form>
      )}
    </div>
  )
}
