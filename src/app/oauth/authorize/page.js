'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase, getAuthHeader } from '../../../lib/supabase'

const KEYS = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method']

function Consent() {
  const params = useSearchParams()
  const query = Object.fromEntries(KEYS.map((k) => [k, params.get(k)]).filter(([, v]) => v != null))
  const qs = new URLSearchParams(query).toString()
  const [signedIn, setSignedIn] = useState(null)
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (!alive) return
      setSignedIn(!!data?.user)
      if (!data?.user) return
      const res = await fetch(`/api/oauth/authorize?${qs}`, { headers: await getAuthHeader() })
      const body = await res.json().catch(() => ({}))
      if (!alive) return
      if (body.redirect) window.location.assign(body.redirect)
      else if (!res.ok) setError(body.error || 'This request is not valid.')
      else setInfo(body)
    })()
    return () => { alive = false }
  }, [qs])

  const decide = async (approve) => {
    setBusy(true)
    const res = await fetch('/api/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify({ ...query, approve }),
    })
    const body = await res.json().catch(() => ({}))
    if (body.redirect) window.location.assign(body.redirect)
    else {
      setBusy(false)
      setError(body.error || 'Something went wrong.')
    }
  }

  if (signedIn === false) {
    return (
      <p className="text-sm text-slate-500">
        <Link href={`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`} className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">Log in</Link> to Velocity Stack.
      </p>
    )
  }
  if (error) return <p className="text-sm text-rose-500">{error}</p>
  if (!info) return <p className="text-sm text-slate-500">Loading...</p>
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
      <h1 className="text-xl font-black text-slate-900 dark:text-white">Connect {info.app.name}</h1>
      {info.app.description && <p className="text-sm text-slate-600 dark:text-slate-300">{info.app.description}</p>}
      <p className="text-sm text-slate-600 dark:text-slate-300">{info.app.name} will be able to:</p>
      <ul className="list-disc pl-5 text-sm text-slate-700 dark:text-slate-200">
        {info.scopes.map((s) => <li key={s.scope}>{s.label}</li>)}
      </ul>
      <p className="text-xs text-slate-500">You can disconnect it at any time on the Connections page. Activities it already sent stay in your account.</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => decide(true)} className="py-2 px-4 rounded-xl bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider disabled:opacity-50">Allow</button>
        <button type="button" disabled={busy} onClick={() => decide(false)} className="py-2 px-4 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs uppercase tracking-wider disabled:opacity-50">Cancel</button>
      </div>
    </div>
  )
}

export default function AuthorizePage() {
  return (
    <section className="max-w-md mx-auto">
      <Suspense fallback={null}><Consent /></Suspense>
    </section>
  )
}
