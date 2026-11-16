'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { acceptCoaching, declineCoaching } from '../../../../lib/coaching'
import { fetchCoachApplication, healthFlag } from '../../../../lib/coachOnboarding'
import ApplicationView from '../../../../components/ApplicationView'
import { athletePath } from '../../../../lib/coachContext'

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

  if (app === undefined) return <p className="text-sm text-slate-400">Loading…</p>
  if (!app) return <p className="text-sm text-slate-500">Application not found, withdrawn, or no longer available. <Link href="/coach" className="underline">Back</Link></p>

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
    <div className="max-w-2xl space-y-4" data-testid="application-page">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Application from {app.rider_name}</h1>
      {healthFlag(app.health) && <p className="text-xs font-bold text-amber-700 dark:text-amber-300">At least one PAR-Q answer is YES: consider asking for medical clearance.</p>}
      <ApplicationView answers={app.answers} health={app.health} healthDeclined={app.health_declined} minor={app.minor} coachAnswers={app.coach_answers} questions={app.questions} />
      {pending ? (
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => act(acceptCoaching, 'Accepted')} className="px-4 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white disabled:opacity-50">Accept</button>
          <button disabled={busy} onClick={() => act(declineCoaching, 'Declined')} className="px-4 py-2 rounded-lg text-sm font-bold border border-slate-300 dark:border-slate-700 disabled:opacity-50">Decline</button>
        </div>
      ) : (
        <Link href={athletePath(app.rider_id)} className="underline text-sm font-bold">Open athlete</Link>
      )}
      {msg && <p className={`text-sm ${msg.error ? 'text-rose-600' : 'text-emerald-600'}`}>{msg.text}</p>}
    </div>
  )
}
