'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import {
  canEditMessage, chatErrorMessage, deleteMessage, editMessage, fetchMessages, markRead, mergeMessages,
  MAX_MESSAGE_LENGTH, reportMessage, sendMessage,
} from '../../../lib/coachChat'
import { acceptCoaching } from '../../../lib/coaching'
import Icon from '../../../components/Icon'
import { ErrorNote, StatusNote, adminBtn, adminCard, adminInput } from '../../../components/admin/AdminUi'

export default function ChatThreadPage() {
  const { id } = useParams()
  const router = useRouter()
  const [me, setMe] = useState(null)
  const [thread, setThread] = useState(undefined)
  const [messages, setMessages] = useState([])
  const [body, setBody] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const bottom = useRef(null)

  const load = useCallback(async () => {
    const { thread: t } = await fetchMessages(supabase, id)
    setThread(t)
    if (t) {
      setMessages(mergeMessages(t.messages))
      markRead(supabase, id)
    }
  }, [id])

  useEffect(() => {
    let channel
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return router.push('/login')
      setMe(session.user.id)
      await load()
      // Realtime is only a ping; content is always re-read through the RPC.
      channel = supabase.channel(`chat-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${id}` }, () => load())
        .subscribe()
    })()
    return () => { if (channel) supabase.removeChannel(channel) }
  }, [id, load, router])

  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'end' }) }, [messages.length])

  if (thread === undefined) return <p className="text-sm text-slate-600 dark:text-slate-300" role="status">Loading conversation…</p>
  if (!thread) return <div className={`${adminCard} max-w-2xl mx-auto text-sm text-slate-700 dark:text-slate-200 space-y-3`}>
    <p>Conversation not found or no longer available.</p>
    <Link href="/chat" className={adminBtn.secondary}><Icon name="chevronLeft" /> Messages</Link>
  </div>

  if (thread.status === 'pending') {
    const accept = async () => {
      setBusy(true)
      const { error } = await acceptCoaching(supabase, id)
      setBusy(false)
      if (error) setMsg({ error: true, text: chatErrorMessage(error) })
      else await load()
    }
    return <div className={`${adminCard} max-w-2xl mx-auto text-sm text-slate-700 dark:text-slate-200 space-y-3`} data-testid="chat-pending">
      <p className="font-bold">Waiting for acceptance</p>
      <p>{thread.initiated_by_me ? 'Your coaching request has not been accepted yet. You can message each other once it is.' : 'You have a coaching invitation. Accept it to start chatting.'}</p>
      {msg?.error && <ErrorNote>{msg.text}</ErrorNote>}
      {!thread.initiated_by_me && <button type="button" disabled={busy} onClick={accept} className={adminBtn.primary}>Accept</button>}{' '}
      <Link href="/chat" className={adminBtn.secondary}><Icon name="chevronLeft" /> Messages</Link>
    </div>
  }

  const act = async (fn) => {
    setBusy(true)
    const { error } = await fn()
    setBusy(false)
    setMsg(error ? { error: true, text: chatErrorMessage(error) } : null)
    if (!error) await load()
    return !error
  }
  const send = async (e) => {
    e.preventDefault()
    if (!body.trim()) return
    if (await act(() => sendMessage(supabase, id, body))) setBody('')
  }
  const edit = (m) => {
    const next = window.prompt('Edit message', m.body)
    if (next !== null) act(() => editMessage(supabase, m.id, next))
  }
  const remove = (m) => window.confirm('Delete this message?') && act(() => deleteMessage(supabase, m.id))
  const report = (m) => {
    const reason = window.prompt('Why are you reporting this message?')
    if (reason) act(() => reportMessage(supabase, m.id, reason)).then((okay) => okay && setMsg({ text: 'Reported. An admin will review it.' }))
  }

  const link = 'inline-flex items-center min-h-[32px] underline underline-offset-2 font-semibold'
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-3 min-h-[calc(100dvh-10rem)]" data-testid="chat-thread">
      <Link href="/chat" className="inline-flex items-center gap-1 min-h-[44px] text-sm font-bold text-slate-700 dark:text-slate-200 hover:text-orange-600 dark:hover:text-orange-400">
        <Icon name="chevronLeft" /> Messages
      </Link>
      {messages.length === 0 && <p className="text-sm text-center text-slate-600 dark:text-slate-300 py-8">No messages yet. Start the conversation below.</p>}
      <ul className="flex-1 space-y-3">
        {messages.map((m) => {
          const mine = m.sender_id === me
          return (
            <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${mine ? 'bg-orange-600 text-white rounded-br-md' : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-600 rounded-bl-md'}`}>
                {m.deleted ? <em className="opacity-80">Message deleted</em> : <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.activity && <Link href={`/activities/${m.activity.id}`} className={`${link} text-xs mt-1`}>Activity: {m.activity.title}</Link>}
                {m.workout && <p className="text-xs mt-1 font-semibold">Workout: {m.workout.title}</p>}
                <p className={`text-xs mt-1 flex flex-wrap items-center gap-x-3 ${mine ? 'text-white/90' : 'text-slate-600 dark:text-slate-300'}`}>
                  <span>{new Date(m.created_at).toLocaleString()}{m.edited_at && ' · edited'}</span>
                  {!m.deleted && thread.can_send && mine && canEditMessage(m, me) && <button type="button" onClick={() => edit(m)} className={link}>Edit</button>}
                  {!m.deleted && thread.can_send && mine && <button type="button" onClick={() => remove(m)} className={link}>Delete</button>}
                  {!m.deleted && !mine && <button type="button" onClick={() => report(m)} className={link}>Report</button>}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
      <div ref={bottom} />
      {msg && (msg.error ? <ErrorNote>{msg.text}</ErrorNote> : <StatusNote>{msg.text}</StatusNote>)}
      {thread.can_send ? (
        <form onSubmit={send} className="sticky bottom-0 glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-2 flex items-end gap-2">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={MAX_MESSAGE_LENGTH} rows={2} placeholder="Write a message" aria-label="Message"
            className={`${adminInput} !py-2 resize-none`} />
          <button disabled={busy || !body.trim()} className={`${adminBtn.primary} shrink-0`}>Send</button>
        </form>
      ) : (
        <p className={`${adminCard} text-sm text-slate-700 dark:text-slate-200`}>This conversation is read-only because the coaching relationship has ended.</p>
      )}
    </div>
  )
}
