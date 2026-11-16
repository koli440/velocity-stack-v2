'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  deleteMyLicence, fetchLicenceBodies, fetchMyLicence, licenceErrorMessage, licenceStatusLabel, saveMyLicence, uploadEvidence,
} from '../lib/coachLicence'

const input = 'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm'

// Coach licence: declare body/level, optionally upload evidence for admin verification.
export default function CoachLicenceEditor() {
  const [bodies, setBodies] = useState([])
  const [lic, setLic] = useState(undefined)
  const [form, setForm] = useState({ bodyId: '', level: '', number: '', validUntil: '' })
  const [file, setFile] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { licence } = await fetchMyLicence(supabase)
    setLic(licence)
    if (licence) setForm({ bodyId: licence.body_id, level: licence.level, number: licence.licence_number || '', validUntil: licence.valid_until || '' })
  }
  useEffect(() => { fetchLicenceBodies(supabase).then(setBodies); load() }, [])
  if (lic === undefined) return null

  const body = bodies.find((b) => b.id === form.bodyId)
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    let evidencePath = lic?.evidence_path || null
    if (file) {
      const { data: { session } } = await supabase.auth.getSession()
      const up = await uploadEvidence(supabase, session.user.id, file)
      if (up.error) { setBusy(false); return setMsg({ error: true, text: licenceErrorMessage(up.error) }) }
      evidencePath = up.path
    }
    const { error } = await saveMyLicence(supabase, { ...form, evidencePath })
    setBusy(false)
    setMsg(error ? { error: true, text: licenceErrorMessage(error) } : { text: 'Saved' })
    setFile(null)
    load()
  }
  const remove = async () => {
    if (!window.confirm('Remove your licence details?')) return
    await deleteMyLicence(supabase)
    setForm({ bodyId: '', level: '', number: '', validUntil: '' })
    setMsg({ text: 'Removed' })
    load()
  }
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="coach-licence">
      <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Coaching licence</h2>
      <p className="text-xs text-slate-500">
        Optional. Without evidence your licence shows as &ldquo;self-declared&rdquo;. Upload a PDF or image (max 5 MB, visible only to you and admins) and an admin checks it against the issuing body&apos;s register. Changing any detail restarts the check.
      </p>
      {lic && <p className="text-xs font-bold" data-testid="licence-status">Status: {licenceStatusLabel(lic.status)}{lic.review_note ? ` — ${lic.review_note}` : ''}</p>}
      <form onSubmit={save} className="space-y-2">
        <select required className={input} aria-label="Licence body" value={form.bodyId} onChange={(e) => setForm({ ...form, bodyId: e.target.value, level: '' })}>
          <option value="">Issuing body…</option>
          {bodies.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select required className={input} aria-label="Level" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
          <option value="">Level…</option>
          {(body?.levels || []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input className={input} aria-label="Licence number" maxLength={60} placeholder="Licence number (optional, never public)" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
        <label className="block text-xs text-slate-500">Valid until (optional)
          <input type="date" className={input} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
        </label>
        <label className="block text-xs text-slate-500">Evidence {lic?.evidence_path ? '(uploaded; choose a file to replace)' : ''}
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="block text-sm" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <div className="flex gap-3 items-center">
          <button disabled={busy} className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50">Save licence</button>
          {lic && <button type="button" className="text-xs underline text-red-600" onClick={remove}>Remove</button>}
          {msg && <span className={`text-xs font-bold ${msg.error ? 'text-rose-600' : 'text-emerald-500'}`}>{msg.text}</span>}
        </div>
      </form>
    </section>
  )
}
