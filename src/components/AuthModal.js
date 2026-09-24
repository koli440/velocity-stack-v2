'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthModal({ user, onAuthChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)

  const handleAuth = async (e) => {
    e.preventDefault()
    setLoading(true)
    setErrorMessage(null)

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        })
        if (error) throw error
        if (data?.user) {
          onAuthChange(data.user)
          setIsOpen(false)
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
        if (data?.user) {
          onAuthChange(data.user)
          setIsOpen(false)
        }
      }
    } catch (err) {
      setErrorMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    onAuthChange(null)
  }

  // Přihlášený uživatel – widget profilu
  if (user) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleSignOut}
          className="py-1.5 px-3 rounded-xl bg-slate-200/70 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition shadow-sm"
        >
          Sign Out
        </button>
      </div>
    )
  }

  // Nepřihlášený uživatel – tlačítko pro otevření modalu
  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="py-2 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider shadow-sm transition"
      >
        Sign In / Register
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-2xl w-full max-w-sm p-6 md:p-8 shadow-2xl relative">
            {/* Zavírací křížek */}
            <button
              onClick={() => {
                setIsOpen(false)
                setErrorMessage(null)
              }}
              className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg font-bold p-1 rounded-lg"
            >
              ✕
            </button>

            {/* Hlavička */}
            <div className="mb-6 text-center">
              <div className="inline-flex h-9 w-9 rounded-xl bg-emerald-500 dark:bg-brand-neon items-center justify-center font-black text-white dark:text-slate-950 text-lg shadow-sm mb-2">
                V
              </div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                {isSignUp ? 'Create Track Account' : 'Welcome to Velocity Stack'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isSignUp
                  ? 'Access your telemetry vault & personal power curves'
                  : 'Sign in to access your track sessions'}
              </p>
            </div>

            {/* Přepínač Login / Sign Up */}
            <div className="flex p-1 bg-slate-100 dark:bg-slate-900 rounded-xl mb-5 border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(false)
                  setErrorMessage(null)
                }}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                  !isSignUp
                    ? 'bg-white dark:bg-surface-darkCard text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(true)
                  setErrorMessage(null)
                }}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                  isSignUp
                    ? 'bg-white dark:bg-surface-darkCard text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Sign Up
              </button>
            </div>

            {/* Chybová hláška */}
            {errorMessage && (
              <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-medium">
                {errorMessage}
              </div>
            )}

            {/* Formulář */}
            <form onSubmit={handleAuth} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Email Address
                </label>
                <input
                  required
                  type="email"
                  placeholder="rider@velodrome.cc"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 transition"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Password
                </label>
                <input
                  required
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 transition"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider shadow-md transition disabled:opacity-50"
              >
                {loading
                  ? 'Processing...'
                  : isSignUp
                  ? 'Create Account'
                  : 'Sign In'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}