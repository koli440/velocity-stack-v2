'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import OnboardingForm from '../../../../components/OnboardingForm'
import {
  CONSENT_TEXT, DRAFT_KEY, fetchApplyInfo, onboardingErrorMessage, submitOnboarding,
} from '../../../../lib/coachOnboarding'

// Apply to a coach: login, consent, questionnaire. A draft lives in sessionStorage only (never sent before submit).
export default function ApplyPage() {
  const { slug } = useParams()
  const router = useRouter()
  const [state, setState] = useState({ loading: true, info: null, draft: null })
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return router.push(`/login?next=${encodeURIComponent(`/c/${slug}/apply`)}`)
      const { info } = await fetchApplyInfo(supabase, slug)
      let draft = null
      try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY(slug)) || 'null') } catch { draft = null }
      if (!cancelled) setState({ loading: false, info, draft })
    })()
    return () => { cancelled = true }
  }, [slug, router])

  if (state.loading) return <p className="p-6 text-sm text-slate-500">Loading…</p>
  const { info } = state
  if (!info) return <p className="p-6 text-sm text-slate-500">This coach is not available. <Link href="/coaches" className="underline">Browse coaches</Link></p>
  if (info.is_self) return <p className="p-6 text-sm text-slate-500">You cannot apply to yourself.</p>
  if (info.has_active_coach) return <p className="p-6 text-sm text-slate-500">You already have an active coach. End that coaching first to apply to someone else.</p>
  if (!info.accepting_athletes) return <p className="p-6 text-sm text-slate-500">{info.name} is not accepting new athletes right now.</p>
  if (info.submission_status === 'submitted') {
    return <p className="p-6 text-sm text-slate-500">You already applied to {info.name}. Review or withdraw your answers in <Link href="/settings#onboarding" className="underline">Settings</Link>.</p>
  }
  if (done) {
    return (
      <div className="max-w-xl mx-auto p-6 space-y-2" data-testid="apply-done">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Application sent</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">{info.name} will review it. You can edit, withdraw or delete your answers anytime in <Link href="/settings#onboarding" className="underline">Settings</Link>.</p>
      </div>
    )
  }
  return (
    <div className="max-w-xl mx-auto space-y-4">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Apply to {info.name}</h1>
      <OnboardingForm
        initial={state.draft ? { form: state.draft } : undefined}
        questions={info.questions}
        consentText={CONSENT_TEXT}
        submitLabel="Send application"
        onChange={(f) => { try { sessionStorage.setItem(DRAFT_KEY(slug), JSON.stringify(f)) } catch {} }}
        onSubmit={async (payload) => {
          const { error } = await submitOnboarding(supabase, slug, payload)
          if (error) return { error: onboardingErrorMessage(error) }
          try { sessionStorage.removeItem(DRAFT_KEY(slug)) } catch {}
          setDone(true)
          return {}
        }}
      />
    </div>
  )
}
