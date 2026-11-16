'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminPage, AdminMessage, EmptyState, adminCard, adminMuted, adminBtn } from '../../../components/admin/AdminUi'
import { supabase } from '../../../lib/supabase'
import { fetchLicenceQueue, licenceStatusLabel, reviewLicence, signEvidenceUrl } from '../../../lib/coachLicence'

export default function AdminCoachLicencesPage() {
  const [rows, setRows] = useState(null)
  const [denied, setDenied] = useState(false)
  const [notes, setNotes] = useState({})
  const [err, setErr] = useState(null)
  const load = useCallback(async () => {
    const { rows: r, error } = await fetchLicenceQueue(supabase)
    if (error) return setDenied(true)
    setRows(r)
  }, [])
  useEffect(() => { load() }, [load])

  const decide = async (id, decision) => {
    const { error } = await reviewLicence(supabase, id, decision, notes[id])
    setErr(error ? error.message : null)
    load()
  }
  const open = async (path) => {
    const url = await signEvidenceUrl(supabase, path)
    if (url) window.open(url, '_blank', 'noopener')
  }
  if (denied) return <AdminMessage>Admins only.</AdminMessage>
  if (!rows) return <AdminMessage>Loading…</AdminMessage>
  return (
    <AdminPage title="Coach licences" description="Oldest first. Check the evidence against the issuing body's public register, then verify or reject (a note is required to reject or revoke).">
      {err && <AdminMessage>{err}</AdminMessage>}
      {rows.length === 0 && <EmptyState>Nothing to review.</EmptyState>}
      {rows.map((r) => (
        <section key={r.id} className={`${adminCard} space-y-2`}>
          <div className="flex justify-between gap-2">
            <span className="font-bold">{r.coach_name}{r.coach_slug && <a className="ml-2 underline text-xs" href={`/c/${r.coach_slug}`}>card</a>}</span>
            <span className={`text-xs ${adminMuted}`}>{licenceStatusLabel(r.status)}</span>
          </div>
          <p className="text-sm">{r.body} · {r.level}{r.licence_number ? ` · No. ${r.licence_number}` : ''}{r.valid_until ? ` · valid until ${r.valid_until}` : ''}</p>
          {r.evidence_path && <button className={adminBtn.secondary} onClick={() => open(r.evidence_path)}>Open evidence</button>}
          {r.review_note && <p className={`text-xs ${adminMuted}`}>Note: {r.review_note}</p>}
          {(r.status === 'pending' || r.status === 'verified') && (
            <div className="space-y-2">
              <input className="w-full rounded border px-2 py-1 text-sm bg-transparent" placeholder="Note" value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
              <div className="flex gap-2">
                {r.status === 'pending' && <button className={adminBtn.secondary} onClick={() => decide(r.id, 'verify')}>Verify</button>}
                {r.status === 'pending' && <button className={adminBtn.secondary} onClick={() => decide(r.id, 'reject')}>Reject</button>}
                {r.status === 'verified' && <button className={adminBtn.secondary} onClick={() => decide(r.id, 'revoke')}>Revoke</button>}
              </div>
            </div>
          )}
        </section>
      ))}
    </AdminPage>
  )
}
