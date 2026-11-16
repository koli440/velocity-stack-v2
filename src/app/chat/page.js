'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { fetchThreads, threadHref } from '../../lib/coachChat'
import Avatar from '../../components/Avatar'
import Icon from '../../components/Icon'
import { AdminPage, ErrorNote, adminCard, adminMuted } from '../../components/admin/AdminUi'

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
    <AdminPage title="Messages" description="Conversations with your coach or athletes." back={{ href: '/', label: 'Home' }} width="max-w-2xl">
      <div data-testid="chat-list" className="space-y-4">
        {state.loading && <p className="text-sm text-slate-600 dark:text-slate-300" role="status">Loading conversations…</p>}
        {state.error && <ErrorNote>Messages are not available for your account yet.</ErrorNote>}
        {!state.loading && !state.error && state.threads.length === 0 && (
          <div className={`${adminCard} flex flex-col items-center gap-2 text-center py-8`}>
            <Icon name="chat" size={28} className="text-slate-500 dark:text-slate-400" />
            <p className="text-sm font-bold text-slate-900 dark:text-white">No conversations yet</p>
            <p className={`text-sm ${adminMuted}`}>Chat opens when a coaching relationship is active.</p>
          </div>
        )}
        {state.threads.length > 0 && (
          <ul className={`${adminCard} !p-0 overflow-hidden divide-y divide-slate-200 dark:divide-surface-darkBorder`}>
            {state.threads.map((t) => (
              <li key={t.id}>
                <Link href={threadHref(t)} className="flex items-center gap-3 px-4 py-3 min-h-[64px] hover:bg-slate-50 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500">
                  <Avatar name={t.other_name} size="w-10 h-10" textSize="text-sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">{t.other_name}</span>
                    <span className={`block truncate text-xs ${adminMuted}`}>{t.role === 'coach' ? 'Athlete' : 'Coach'}{t.status === 'ended' ? ' · ended' : ''}{t.status === 'pending' ? (t.initiated_by_me ? ' · Request sent, waiting for acceptance' : ' · Invitation waiting for your answer — open to accept') : ''}{!t.last_message_at && t.status === 'active' ? ' · Start the conversation' : ''}</span>
                  </span>
                  {t.unread > 0 && <span className="shrink-0 min-w-[24px] text-center rounded-full bg-orange-500 text-white text-xs font-bold px-2 py-0.5" aria-label={`${t.unread} unread`}>{t.unread}</span>}
                  <Icon name="chevronRight" className="shrink-0 text-slate-500 dark:text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminPage>
  )
}
