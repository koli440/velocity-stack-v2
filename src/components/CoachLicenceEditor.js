'use client'

import { useEffect, useState } from 'react'
import { adminCard, adminInput, adminMuted, adminBtn } from './admin/AdminUi'
import { supabase } from '../lib/supabase'
import {
  deleteMyLicence, fetchLicenceBodies, fetchMyLicence, licenceErrorMessage, licenceStatusLabel, saveMyLicence, uploadEvidence,
} from '../lib/coachLicence'

const input = adminInput

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
    <section className={`${adminCard} space-y-3`} data-testid="coach-licence">
      <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Coaching licence</h2>
      <p className={`text-sm ${adminMuted}`}>
        Optional. Without evidence your licence shows as &ldquo;self-declared&rdquo;. Upload a PDF or image (max 5 MB, visible only to you and admins) and an admin checks it against the issuing body&apos;s register. Changing any detail restarts the check.
      </p>
      {lic && <p className="text-sm font-bold text-slate-900 dark:text-white" data-testid="licence-status">Status: {licenceStatusLabel(lic.status)}{lic.review_note ? ` — ${lic.review_note}` : ''}</p>}
      <form onSubmit={save} className="space-y-3">
        <select required className={input} aria-label="Licence body" value={form.bodyId} onChange={(e) => setForm({ ...form, bodyId: e.target.value, level: '' })}>
          <option value="">Issuing body…</option>
          {bodies.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select required className={input} aria-label="Level" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
          <option value="">Level…</option>
          {(body?.levels || []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input className={input} aria-label="Licence number" maxLength={60} placeholder="Licence number (optional, never public)" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 space-y-1">Valid until (optional)
          <input type="date" className={input} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
        </label>
        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 space-y-1">Evidence {lic?.evidence_path ? '(uploaded; choose a file to replace)' : ''}
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="block text-sm text-slate-800 dark:text-slate-100" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <div className="flex flex-wrap gap-2 items-center">
          <button disabled={busy} className={adminBtn.primary}>Save licence</button>
          {lic && <button type="button" className={adminBtn.danger} onClick={remove}>Remove</button>}
          {msg && <span className={`text-xs font-bold ${msg.error ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{msg.text}</span>}
        </div>
      </form>
    </section>
  )
}
