'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthModal({ user, onAuthChange }) {
  const [isRegister, setIsRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleAuth = async (e) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    

    try {
      if (isRegister) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        })
        if (error) throw error

        // Pokud je vyžadováno potvrzení e-mailu, session je null
        if (data?.user && !data?.session) {
          alert('📨 Registration successful! Please check your email and click the confirmation link before logging in.')
          setIsRegister(false) // Přepnout na login formulář
          return
        }

        if (data?.user) {
          onAuthChange(data.user)
        }
      }
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    onAuthChange(null)
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-300 font-mono">
          👤 {user.email}
        </span>
        <button
          onClick={handleLogout}
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold py-1.5 px-3 rounded border border-slate-700 transition"
        >
          Sign Out
        </button>
      </div>
    )
  }

  return (
    <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
      <form onSubmit={handleAuth} className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          required
          placeholder="Rider email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-track-orange"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-track-orange"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-track-orange hover:bg-orange-600 text-white font-bold py-1.5 px-4 rounded text-sm transition"
        >
          {loading ? '...' : isRegister ? 'Register' : 'Log In'}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsRegister(!isRegister)
            setErrorMsg('')
          }}
          className="text-xs text-slate-400 hover:text-slate-200 underline ml-2"
        >
          {isRegister ? 'Already have account? Log In' : 'Need account? Sign Up'}
        </button>
      </form>
      {errorMsg && (
        <div className="text-xs text-rose-400 mt-2 font-medium">
          ⚠️ {errorMsg}
        </div>
      )}
    </div>
  )
}
