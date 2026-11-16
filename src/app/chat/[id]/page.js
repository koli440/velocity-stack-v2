'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import {
  canEditMessage, chatErrorMessage, deleteMessage, editMessage, fetchMessages, markRead, mergeMessages,
  MAX_MESSAGE_LENGTH, reportMessage, sendMessage,
} from '../../../lib/coachChat'

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

  if (thread === undefined) return <p className="text-sm text-slate-400">Loading…</p>
  if (!thread) return <p className="text-sm text-slate-500">Conversation not found or no longer available. <Link href="/chat" className="underline">Back</Link></p>

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

  return (
    <div className="max-w-2xl mx-auto space-y-3" data-testid="chat-thread">
      <Link href="/chat" className="text-xs underline text-slate-500">← Messages</Link>
      <ul className="space-y-2">
        {messages.map((m) => {
          const mine = m.sender_id === me
          return (
            <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-orange-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'}`}>
                {m.deleted ? <em className="opacity-70">Message deleted</em> : <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.activity && <Link href={`/activities/${m.activity.id}`} className="block text-xs underline mt-1">Activity: {m.activity.title}</Link>}
                {m.workout && <p className="text-xs mt-1">Workout: {m.workout.title}</p>}
                <p className="text-[10px] opacity-70 mt-1 flex gap-2">
                  {new Date(m.created_at).toLocaleString()}{m.edited_at && ' · edited'}
                  {!m.deleted && thread.can_send && mine && canEditMessage(m, me) && <button type="button" onClick={() => edit(m)} className="underline">Edit</button>}
                  {!m.deleted && thread.can_send && mine && <button type="button" onClick={() => remove(m)} className="underline">Delete</button>}
                  {!m.deleted && !mine && <button type="button" onClick={() => report(m)} className="underline">Report</button>}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
      <div ref={bottom} />
      {msg && <p className={`text-xs ${msg.error ? 'text-red-500' : 'text-emerald-600'}`}>{msg.text}</p>}
      {thread.can_send ? (
        <form onSubmit={send} className="flex gap-2">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={MAX_MESSAGE_LENGTH} rows={2} placeholder="Write a message" aria-label="Message"
            className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent p-2 text-sm" />
          <button disabled={busy || !body.trim()} className="rounded-xl bg-orange-500 text-white text-sm font-bold px-4 disabled:opacity-50">Send</button>
        </form>
      ) : (
        <p className="text-xs text-slate-500">This conversation is read-only because the coaching relationship has ended.</p>
      )}
    </div>
  )
}
