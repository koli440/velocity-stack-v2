'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { useCoachModule } from './useCoachModule'
import {
  answersToForm, deleteOnboarding, editOnboarding, fetchMyOnboarding, onboardingErrorMessage, withdrawOnboarding,
} from '../lib/coachOnboarding'
import ApplicationView from './ApplicationView'
import OnboardingForm from './OnboardingForm'

const SETUP_LABELS = { ftp: 'FTP', weight: 'Weight', thresholds: 'Thresholds', race: 'Race', calendar_note: 'Unavailable day' }

// "My onboarding answers": review, edit, withdraw consent or delete what I told a coach; shows what auto-setup created.
export default function MyOnboardingPanel() {
  const enabled = useCoachModule()
  const [rows, setRows] = useState([])
  const [editing, setEditing] = useState(null)
  const [msg, setMsg] = useState(null)
  const load = useCallback(async () => setRows((await fetchMyOnboarding(supabase)).rows), [])
  // Shown even with the flag off so riders can always withdraw or delete (a privacy right).
  useEffect(() => { load() }, [load, enabled])
  if (rows.length === 0) return null

  const run = async (fn, id, ok, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    const { error } = await fn(supabase, id)
    setMsg(error ? { error: true, text: onboardingErrorMessage(error) } : { text: ok })
    load()
  }
  return (
    <section id="onboarding" className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-4" data-testid="my-onboarding">
      <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">My onboarding answers</h2>
      {rows.map((r) => (
        <div key={r.id} className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            {r.coach_name} <span className="font-normal text-slate-500">· {r.status === 'withdrawn' ? 'consent withdrawn' : r.relationship_status === 'active' ? 'coaching' : r.relationship_status || 'submitted'}</span>
          </p>
          {r.setup.length > 0 && (
            <ul className="text-xs text-slate-600 dark:text-slate-300 list-disc pl-5" data-testid="onboarding-setup">
              {r.setup.map((s, i) => <li key={i}>{SETUP_LABELS[s.target] || s.target}: {s.status}{s.detail ? ` (${s.detail})` : ''}</li>)}
            </ul>
          )}
          {editing === r.id ? (
            <OnboardingForm
              consentRequired={false}
              initial={{ form: answersToForm(r.answers), health: r.health, healthDeclined: r.health_declined, coachAnswers: r.coach_answers }}
              submitLabel="Save changes"
              onSubmit={async (p) => {
                const { error } = await editOnboarding(supabase, r.id, p)
                if (error) return { error: onboardingErrorMessage(error) }
                setEditing(null)
                load()
                return {}
              }}
            />
          ) : (
            <details>
              <summary className="text-xs font-bold cursor-pointer">View answers</summary>
              <ApplicationView answers={r.answers} health={r.health} healthDeclined={r.health_declined} coachAnswers={r.coach_answers} />
            </details>
          )}
          <div className="flex flex-wrap gap-3 text-xs font-bold">
            {r.status === 'submitted' && editing !== r.id && <button className="underline" onClick={() => setEditing(r.id)}>Edit</button>}
            {editing === r.id && <button className="underline" onClick={() => setEditing(null)}>Cancel</button>}
            {r.status === 'submitted' && <button className="underline" onClick={() => run(withdrawOnboarding, r.id, 'Consent withdrawn', 'Withdraw consent? The coach loses access and a pending request is cancelled.')}>Withdraw consent</button>}
            <button className="underline text-red-600" onClick={() => run(deleteOnboarding, r.id, 'Answers deleted', 'Delete these answers permanently?')}>Delete answers</button>
            {r.coach_slug && <Link className="underline" href={`/c/${r.coach_slug}`}>Coach card</Link>}
          </div>
        </div>
      ))}
      {msg && <p className={`text-xs font-bold ${msg.error ? 'text-rose-600' : 'text-emerald-600'}`}>{msg.text}</p>}
    </section>
  )
}
