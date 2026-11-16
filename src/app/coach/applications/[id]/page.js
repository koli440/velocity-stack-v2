'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { acceptCoaching, declineCoaching } from '../../../../lib/coaching'
import { fetchCoachApplication, healthFlag } from '../../../../lib/coachOnboarding'
import ApplicationView from '../../../../components/ApplicationView'
import { athletePath } from '../../../../lib/coachContext'
import Icon from '../../../../components/Icon'
import { AdminPage, ErrorNote, StatusNote, adminBtn, adminCard, adminMuted } from '../../../../components/admin/AdminUi'

export default function ApplicationPage() {
  const { id } = useParams()
  const router = useRouter()
  const [app, setApp] = useState(undefined)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return router.push('/login')
      const { application } = await fetchCoachApplication(supabase, id)
      setApp(application)
    })()
  }, [id, router])

  if (app === undefined) return <p className={`text-sm ${adminMuted}`} role="status">Loading…</p>
  if (!app) return <div className={`${adminCard} max-w-2xl mx-auto space-y-3 text-sm text-slate-700 dark:text-slate-200`}>
    <p>Application not found, withdrawn, or no longer available.</p>
    <Link href="/coach" className={adminBtn.secondary}><Icon name="chevronLeft" /> Coach dashboard</Link>
  </div>

  const act = async (fn, okText) => {
    setBusy(true)
    const { error } = await fn(supabase, app.relationship_id)
    setBusy(false)
    if (error) return setMsg({ error: true, text: error.message })
    setMsg({ text: okText })
    router.push('/coach')
  }
  const pending = app.relationship_status === 'pending'
  return (
    <AdminPage title={`Application from ${app.rider_name}`} back={{ href: '/coach', label: 'Coach dashboard' }} width="max-w-2xl">
      <div className="space-y-4" data-testid="application-page">
        {healthFlag(app.health) && <ErrorNote>At least one PAR-Q answer is YES: consider asking for medical clearance.</ErrorNote>}
        <ApplicationView answers={app.answers} health={app.health} healthDeclined={app.health_declined} minor={app.minor} coachAnswers={app.coach_answers} questions={app.questions} />
        {pending ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <button disabled={busy} onClick={() => act(acceptCoaching, 'Accepted')} className={adminBtn.success}><Icon name="check" /> Accept</button>
            <button disabled={busy} onClick={() => act(declineCoaching, 'Declined')} className={adminBtn.secondary}>Decline</button>
          </div>
        ) : (
          <Link href={athletePath(app.rider_id)} className={adminBtn.primary}>Open athlete <Icon name="chevronRight" /></Link>
        )}
        {msg && (msg.error ? <ErrorNote>{msg.text}</ErrorNote> : <StatusNote>{msg.text}</StatusNote>)}
      </div>
    </AdminPage>
  )
}
