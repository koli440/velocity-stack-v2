'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Icon from './Icon'
import { adminBtn } from './admin/AdminUi'
import { supabase } from '../lib/supabase'
import { fetchThreads, totalUnread } from '../lib/coachChat'

// "Messages" entry point; renders nothing when chat is unavailable (flag off / no coaching relationship).
export default function ChatLink() {
  const [threads, setThreads] = useState(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      const { threads: t, error } = await fetchThreads(supabase)
      if (!cancelled && !error && t.length > 0) setThreads(t)
    })()
    return () => { cancelled = true }
  }, [])
  if (!threads) return null
  const unread = totalUnread(threads)
  return (
    <Link href="/chat" className={`${adminBtn.secondary} self-start w-fit`} data-testid="chat-link">
      <Icon name="chat" /> Messages
      {unread > 0 && <span className="rounded-full bg-orange-500 text-white text-xs font-black px-2 py-0.5">{unread}</span>}
    </Link>
  )
}
