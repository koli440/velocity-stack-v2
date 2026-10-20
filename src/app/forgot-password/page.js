'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import AuthBackground from '../../components/AuthBackground'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    if (error) setErrorMsg(error.message)
    else setSent(true)
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4">
      <AuthBackground />
      <div className="bg-white/25 dark:bg-white/10 backdrop-blur-2xl backdrop-saturate-150 border border-white/20 rounded-3xl w-full max-w-md p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_32px_rgba(0,0,0,0.35)] space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-black text-white uppercase tracking-tight">Reset password</h1>
          <p className="text-xs text-white/80">We'll email you a link to choose a new password</p>
        </div>

        {sent ? (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-400/40 text-emerald-100 text-xs text-center">
            If an account exists for <strong>{email}</strong>, a reset link is on its way.
          </div>
        ) : (
          <>
            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs font-semibold">
                {errorMsg}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-white/80 mb-1">
                  Email Address
                </label>
                <input
                  required
                  type="email"
                  placeholder="rider@velodrome.cc"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-xs text-white placeholder:text-white/50 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/50 transition"
                />
              </div>
              <button type="submit" disabled={loading} className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg transition active:scale-[0.98] disabled:opacity-50">
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
          </>
        )}

        <div className="text-center pt-2 border-t border-white/20">
          <Link href="/login" className="text-xs font-bold text-emerald-300 hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
