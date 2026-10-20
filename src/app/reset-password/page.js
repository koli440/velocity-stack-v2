'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import AuthBackground from '../../components/AuthBackground'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [checked, setChecked] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  // The emailed link signs the rider in (recovery session) from the URL.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
      setChecked(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg(null)
    if (password.length < 6) return setErrorMsg('Password must be at least 6 characters.')
    if (password !== confirm) return setErrorMsg('Passwords do not match.')
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) return setErrorMsg(error.message)
    router.push('/')
    router.refresh()
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4">
      <AuthBackground />
      <div className="bg-white/25 dark:bg-white/10 backdrop-blur-2xl backdrop-saturate-150 border border-white/20 rounded-3xl w-full max-w-md p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_32px_rgba(0,0,0,0.35)] space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-black text-white uppercase tracking-tight">Choose a new password</h1>
        </div>

        {checked && !ready ? (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs text-center space-y-2">
            <p>This reset link is invalid or has expired.</p>
            <Link href="/forgot-password" className="font-bold text-emerald-300 hover:underline">
              Request a new link
            </Link>
          </div>
        ) : (
          <>
            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs font-semibold">
                {errorMsg}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                required
                type="password"
                placeholder="New password (min. 6 chars)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-xs text-white placeholder:text-white/50 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/50 transition"
              />
              <input
                required
                type="password"
                placeholder="Repeat new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-xs text-white placeholder:text-white/50 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/50 transition"
              />
              <button type="submit" disabled={loading || !ready} className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg transition active:scale-[0.98] disabled:opacity-50">
                {loading ? 'Saving...' : 'Save new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
