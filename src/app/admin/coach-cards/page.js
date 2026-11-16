'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminPage, AdminMessage, EmptyState, adminCard, adminMuted, adminBtn } from '../../../components/admin/AdminUi'
import { supabase } from '../../../lib/supabase'

export default function AdminCoachCardsPage() {
  const [rows, setRows] = useState(null)
  const [denied, setDenied] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_coach_card_reports')
    if (error) return setDenied(true)
    setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const resolve = async (id, unpublish) => {
    await supabase.rpc('admin_resolve_coach_card_report', { p_id: id, p_unpublish: unpublish })
    load()
  }

  if (denied) return <AdminMessage>Admins only.</AdminMessage>
  if (!rows) return <AdminMessage>Loading…</AdminMessage>
  return (
    <AdminPage title="Coach card reports" description="Reports about public coach cards. Unpublishing also removes the card from the directory.">
      {rows.length === 0 && <EmptyState>No reports.</EmptyState>}
      {rows.map((r) => (
        <section key={r.id} className={`${adminCard} space-y-2`}>
          <div className="flex justify-between gap-2">
            <a className="font-bold underline" href={`/c/${r.slug}`}>{r.coach_name} ({r.slug})</a>
            <span className={`text-xs ${adminMuted}`}>{r.status} · {r.is_public ? 'public' : 'unpublished'}</span>
          </div>
          <p className="text-sm whitespace-pre-line">{r.reason}</p>
          {r.status === 'open' && (
            <div className="flex gap-2">
              <button className={adminBtn.secondary} onClick={() => resolve(r.id, false)}>Dismiss</button>
              <button className={adminBtn.secondary} onClick={() => resolve(r.id, true)}>Unpublish card</button>
            </div>
          )}
        </section>
      ))}
    </AdminPage>
  )
}
