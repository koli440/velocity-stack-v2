'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import ConnectionsPage from '../../components/ConnectionsPage'

export default function Connections() {
  const [userId, setUserId] = useState(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data?.user?.id || null)
      setChecked(true)
    }).catch(() => setChecked(true))
  }, [])

  return (
    <section className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Connections</h1>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Where your rides come from, in order of preference. Back to{' '}
          <Link href="/settings" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">Settings</Link>.
        </p>
      </div>
      {checked && !userId ? (
        <p className="text-sm text-slate-500">
          <Link href="/login" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">Log in</Link> to manage your connections.
        </p>
      ) : (
        <section className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-5 md:p-6">
          <ConnectionsPage userId={userId} />
        </section>
      )}
    </section>
  )
}
