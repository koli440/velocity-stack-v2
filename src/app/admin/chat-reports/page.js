'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminPage, AdminMessage, EmptyState, adminCard, adminMuted, adminBtn } from '../../../components/admin/AdminUi'
import { supabase } from '../../../lib/supabase'
import { fetchChatReports, resolveChatReport } from '../../../lib/coachChat'

export default function AdminChatReportsPage() {
  const [rows, setRows] = useState(null)
  const [denied, setDenied] = useState(false)
  const load = useCallback(async () => {
    const { rows: r, error } = await fetchChatReports(supabase)
    if (error) return setDenied(true)
    setRows(r)
  }, [])
  useEffect(() => { load() }, [load])
  const resolve = async (id, actionTaken) => {
    await resolveChatReport(supabase, id, actionTaken)
    load()
  }
  if (denied) return <AdminMessage>Admins only.</AdminMessage>
  if (!rows) return <AdminMessage>Loading…</AdminMessage>
  return (
    <AdminPage title="Chat reports" description="Only reported messages are visible here (a snapshot taken at report time).">
      {rows.length === 0 && <EmptyState>No reports.</EmptyState>}
      {rows.map((r) => (
        <section key={r.id} className={`${adminCard} space-y-2`}>
          <div className="flex justify-between gap-2">
            <span className="font-bold">{r.sender_name} <span className={`text-xs font-normal ${adminMuted}`}>reported by {r.reporter_name}</span></span>
            <span className={`text-xs ${adminMuted}`}>{r.status}</span>
          </div>
          <p className="text-sm whitespace-pre-line">“{r.body_snapshot}”</p>
          <p className={`text-xs ${adminMuted}`}>Reason: {r.reason}</p>
          {r.status === 'open' && (
            <div className="flex gap-2">
              <button className={adminBtn.secondary} onClick={() => resolve(r.id, false)}>Dismiss</button>
              <button className={adminBtn.secondary} onClick={() => resolve(r.id, true)}>Action taken</button>
            </div>
          )}
        </section>
      ))}
    </AdminPage>
  )
}
