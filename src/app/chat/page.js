'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { fetchThreads } from '../../lib/coachChat'

export default function ChatListPage() {
  const router = useRouter()
  const [state, setState] = useState({ loading: true, threads: [], error: null })
  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return router.push('/login')
      const { threads, error } = await fetchThreads(supabase)
      setState({ loading: false, threads, error })
    })()
  }, [router])
  return (
    <div className="space-y-4 max-w-2xl mx-auto" data-testid="chat-list">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Messages</h1>
      {state.loading && <p className="text-xs text-slate-400">Loading…</p>}
      {state.error && <p className="text-sm text-slate-500">Messages are not available for your account yet.</p>}
      {!state.loading && !state.error && state.threads.length === 0 && <p className="text-sm text-slate-500">No conversations yet. Chat opens when a coaching relationship is active.</p>}
      <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800">
        {state.threads.map((t) => (
          <li key={t.id}>
            <Link href={`/chat/${t.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-900">
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                {t.other_name} <span className="font-normal text-slate-500">· {t.role === 'coach' ? 'athlete' : 'coach'}{t.status === 'ended' ? ' · ended' : ''}</span>
              </span>
              {t.unread > 0 && <span className="rounded-full bg-orange-500 text-white text-[10px] px-1.5 py-0.5">{t.unread}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
