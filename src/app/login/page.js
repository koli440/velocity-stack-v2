'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import LoginFeaturesModal from '../../components/LoginFeaturesModal'
import Icon from '../../components/Icon'
import AuthBackground from '../../components/AuthBackground'
import GoogleSignInButton from '../../components/GoogleSignInButton'
import CarryLink from '../../components/CarryLink'
import { LOGIN_TOOL_CARDS, registerHref } from '../../lib/signupCatch'
import { nextOrDefault, oauthErrorMessage } from '../../lib/authRedirect'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)
  const [showInfo, setShowInfo] = useState(false)
  const [next, setNext] = useState('/')

  // Returning from a failed/cancelled Google sign-in: /login?error=<code>&next=<path>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setNext(nextOrDefault(params.get('next')))
    const code = params.get('error')
    if (code) {
      setErrorMsg(oauthErrorMessage(code === 'missing_code' ? 'missing_code' : code))
      window.history.replaceState(null, '', '/login')
    }
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg(null)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
    } else if (data?.user) {
      router.push(next)
      router.refresh()
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col lg:flex-row items-center justify-center gap-6 p-4">
      <AuthBackground />
      <div className="bg-white/25 dark:bg-white/10 backdrop-blur-2xl backdrop-saturate-150 border border-white/20 rounded-3xl w-full max-w-md p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_32px_rgba(0,0,0,0.35)] space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 rounded-2xl bg-emerald-500 dark:bg-brand-neon items-center justify-center font-black text-white dark:text-slate-950 text-xl shadow-md">
            V
          </div>
          <h1 className="text-2xl font-black text-white uppercase tracking-tight">
            Velocity<span className="text-emerald-500 dark:text-brand-neon">Stack</span>
          </h1>
          <p className="text-xs text-white/80">
            Sign in to access your telemetry cockpit & track analysis
          </p>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        <GoogleSignInButton next={next} onError={setErrorMsg} disabled={loading} />

        <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-white/60">
          <span className="h-px flex-1 bg-white/20" />
          or
          <span className="h-px flex-1 bg-white/20" />
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
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

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-white/80">
                Password
              </label>
              <Link href="/forgot-password" className="text-[11px] font-bold text-emerald-300 hover:underline">
                Forgot password?
              </Link>
            </div>
            <input
              required
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-xs text-white placeholder:text-white/50 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/50 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg transition active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In to Cockpit'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setShowInfo(true)}
          className="w-full py-3 rounded-xl border border-dashed border-emerald-300 text-emerald-300 font-bold text-xs hover:bg-emerald-500/10 transition"
        >
          <Icon name="sparkle" /> What's inside Velocity Stack?
        </button>

        <p className="text-center text-[11px] text-white/70">
          By continuing you agree to the{' '}
          <Link href="/terms" className="font-bold text-emerald-300 hover:underline">Terms of Service</Link>
          {' '}and the{' '}
          <Link href="/privacy" className="font-bold text-emerald-300 hover:underline">Privacy Policy</Link>.
        </p>

        <div className="text-center pt-2 border-t border-white/20">
          <p className="text-xs text-white/80">
            Don't have an athlete account?{' '}
            <Link
              href={registerHref(next)}
              className="font-bold text-emerald-300 hover:underline"
            >
              Register here
            </Link>
          </p>
        </div>
      </div>
      <aside aria-label="Try without an account" className="w-full max-w-md lg:w-72 lg:max-w-xs grid gap-4 relative">
        {LOGIN_TOOL_CARDS.map((c) => (
          <div
            key={c.key}
            data-testid={`login-card-${c.key}`}
            className="bg-white/25 dark:bg-white/10 backdrop-blur-2xl backdrop-saturate-150 border border-white/20 rounded-3xl p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_32px_rgba(0,0,0,0.35)] space-y-2"
          >
            <h2 className="text-sm font-black text-white uppercase tracking-tight">
              <Icon name={c.icon} size={18} /> {c.title}
            </h2>
            <p className="text-xs text-white/80">{c.description}</p>
            <CarryLink href={c.href} className="inline-block text-xs font-bold text-emerald-300 hover:underline">
              Try without an account &rarr;
            </CarryLink>
          </div>
        ))}
      </aside>
      <LoginFeaturesModal open={showInfo} onClose={() => setShowInfo(false)} />
    </div>
  )
}