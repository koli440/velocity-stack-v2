'use client'

import { useEffect, useState } from 'react'
import { priceLabel } from '../../../../lib/coachCard'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { AdminPage, AdminMessage, StatusNote, adminCard, adminMuted } from '../../../../components/admin/AdminUi'
import OnboardingForm from '../../../../components/OnboardingForm'
import {
  CONSENT_TEXT, DRAFT_KEY, fetchApplyInfo, loadProfilePrefill, onboardingErrorMessage, submitOnboarding,
} from '../../../../lib/coachOnboarding'

// Apply to a coach: login, consent, questionnaire. A draft lives in sessionStorage only (never sent before submit).
export default function ApplyPage() {
  const { slug } = useParams()
  const router = useRouter()
  const [state, setState] = useState({ loading: true, info: null, draft: null })
  const [done, setDone] = useState(false)
  const [packageId, setPackageId] = useState('')
  const [prefill, setPrefill] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return router.push(`/login?next=${encodeURIComponent(`/c/${slug}/apply`)}`)
      const { info } = await fetchApplyInfo(supabase, slug)
      const pre = await loadProfilePrefill(supabase, session.user.id).catch(() => ({ values: {}, fields: [] }))
      let draft = null
      try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY(slug)) || 'null') } catch { draft = null }
      const wanted = new URLSearchParams(window.location.search).get('package')
      const ids = (info?.packages || []).map((p) => p.id)
      const initial = ids.includes(info?.package_id) ? info.package_id : ids.includes(wanted) ? wanted : ''
      if (!cancelled) { setPrefill(pre.values); setPackageId(initial); setState({ loading: false, info, draft }) }
    })()
    return () => { cancelled = true }
  }, [slug, router])

  if (state.loading) return <AdminMessage>Loading…</AdminMessage>
  const { info } = state
  if (!info) return <AdminMessage>This coach is not available. <Link href="/coaches" className="font-bold underline text-orange-700 dark:text-orange-400">Browse coaches</Link></AdminMessage>
  if (info.is_self) return <AdminMessage>You cannot apply to yourself.</AdminMessage>
  if (info.has_active_coach) return <AdminMessage>You already have an active coach. End that coaching first to apply to someone else.</AdminMessage>
  if (!info.accepting_athletes) return <AdminMessage>{info.name} is not accepting new athletes right now.</AdminMessage>
  if (info.submission_status === 'submitted') {
    return <AdminMessage>You already applied to {info.name}. Review or withdraw your answers in <Link href="/settings/coaching#onboarding" className="font-bold underline text-orange-700 dark:text-orange-400">Settings</Link>.</AdminMessage>
  }
  if (done) {
    return (
      <AdminPage title="Application sent" back={{ href: `/c/${slug}`, label: info.name }} width="max-w-xl">
        <div className={`${adminCard} space-y-2`} data-testid="apply-done">
          <StatusNote>Your application was sent.</StatusNote>
          <p className={`text-sm ${adminMuted}`}>{info.name} will review it. You can edit, withdraw or delete your answers anytime in <Link href="/settings/coaching#onboarding" className="font-bold underline text-orange-700 dark:text-orange-400">Settings</Link>.</p>
        </div>
      </AdminPage>
    )
  }
  return (
    <AdminPage title={`Apply to ${info.name}`} back={{ href: `/c/${slug}`, label: info.name }} width="max-w-xl">
      {info.packages?.length > 0 && (
        <fieldset className={`${adminCard} mb-4 space-y-2`} data-testid="apply-packages">
          <legend className="text-sm font-black text-slate-900 dark:text-white px-1">Which package are you interested in?</legend>
          <p className={`text-sm ${adminMuted}`}>Nothing is charged now. If {info.name} accepts you, you will be asked to pay for the plan.</p>
          {info.packages.map((p) => (
            <label key={p.id} className="flex items-start gap-3 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 p-3 cursor-pointer text-sm text-slate-900 dark:text-white">
              <input type="radio" name="package" className="mt-1" checked={packageId === p.id} onChange={() => setPackageId(p.id)} />
              <span><span className="font-bold">{p.title}</span> <span className={adminMuted}>{priceLabel(p) || (p.kind === 'free' ? 'Free' : '')}</span></span>
            </label>
          ))}
          <label className="flex items-center gap-3 min-h-[44px] text-sm text-slate-900 dark:text-white cursor-pointer">
            <input type="radio" name="package" checked={packageId === ''} onChange={() => setPackageId('')} /> Not sure yet
          </label>
        </fieldset>
      )}
      <OnboardingForm
        initial={{ form: { events: [], blackout: [], weekdays: {}, ...prefill, ...(state.draft || {}) } }}
        fromProfile={prefill}
        questions={info.questions}
        consentText={CONSENT_TEXT}
        submitLabel="Send application"
        onChange={(f) => { try { sessionStorage.setItem(DRAFT_KEY(slug), JSON.stringify(f)) } catch {} }}
        onSubmit={async (payload) => {
          const { error } = await submitOnboarding(supabase, slug, { ...payload, packageId })
          if (error) return { error: onboardingErrorMessage(error) }
          try { sessionStorage.removeItem(DRAFT_KEY(slug)) } catch {}
          setDone(true)
          return {}
        }}
      />
    </AdminPage>
  )
}
