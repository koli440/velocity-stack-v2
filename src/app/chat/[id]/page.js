'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import {
  canEditMessage, chatErrorMessage, deleteMessage, editMessage, fetchMessages, fetchReferenceCandidates, referenceParams, threadStateMessage, markRead, mergeMessages,
  MAX_MESSAGE_LENGTH, reportMessage, sendMessage,
} from '../../../lib/coachChat'
import { acceptCoaching, declineCoaching } from '../../../lib/coaching'
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
  const [loadError, setLoadError] = useState(null)
  const [ref, setRef] = useState(null)
  const [picker, setPicker] = useState(null)
  const bottom = useRef(null)

  const load = useCallback(async () => {
    const { thread: t, error } = await fetchMessages(supabase, id)
    setThread(t)
    setLoadError(error)
    if (t?.messages?.length || t?.can_send) {
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
    <p data-testid="chat-unavailable">{threadStateMessage(null, loadError)}</p>
    <Link href="/chat" className={adminBtn.secondary}><Icon name="chevronLeft" /> Messages</Link>
  </div>

  if (thread.status && !['pending', 'active', 'ended'].includes(thread.status)) return <div className={`${adminCard} max-w-2xl mx-auto text-sm text-slate-700 dark:text-slate-200 space-y-3`} data-testid="chat-unavailable">
    <p>{threadStateMessage(thread)}</p>
    <Link href="/chat" className={adminBtn.secondary}><Icon name="chevronLeft" /> Messages</Link>
  </div>

  if (thread.status === 'pending') {
    const name = thread.other_name || 'this person'
    const answer = (fn, back) => async () => {
      setBusy(true)
      const { error } = await fn(supabase, id)
      setBusy(false)
      if (error) setMsg({ error: true, text: chatErrorMessage(error) })
      else if (back) router.push('/chat')
      else await load()
    }
    return <div className={`${adminCard} max-w-2xl mx-auto text-sm text-slate-700 dark:text-slate-200 space-y-3`} data-testid="chat-pending">
      <p className="font-bold">{thread.initiated_by_me ? `Waiting for ${name} to accept` : `${name} invited you`}</p>
      <p>{thread.initiated_by_me ? 'Your coaching request has not been accepted yet. You can message each other once it is.' : 'You have a coaching invitation. Accept it to start chatting.'}</p>
      {msg?.error && <ErrorNote>{msg.text}</ErrorNote>}
      {!thread.initiated_by_me && <><button type="button" disabled={busy} onClick={answer(acceptCoaching)} className={adminBtn.primary}>Accept</button>{' '}<button type="button" disabled={busy} onClick={answer(declineCoaching, true)} className={adminBtn.secondary}>Decline</button>{' '}</>}
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
    if (!body.trim() && !ref) return
    if (await act(() => sendMessage(supabase, id, body, referenceParams(ref)))) { setBody(''); setRef(null) }
  }
  const togglePicker = async () => {
    if (picker) return setPicker(null)
    setPicker({ loading: true, activities: [], workouts: [] })
    const { activities, workouts } = await fetchReferenceCandidates(supabase, id)
    setPicker({ loading: false, activities, workouts })
  }
  const pick = (type, item) => { setRef({ type, id: item.id, title: item.title }); setPicker(null) }
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
        <form onSubmit={send} className="sticky bottom-0 glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-2 space-y-2">
          {ref && (
            <p className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200" data-testid="chat-reference">
              <span className="min-w-0 truncate">{ref.type === 'activity' ? 'Activity' : 'Workout'}: {ref.title}</span>
              <button type="button" onClick={() => setRef(null)} aria-label="Remove reference" className="inline-flex items-center justify-center min-h-[32px] min-w-[32px] rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><Icon name="close" /></button>
            </p>
          )}
          {picker && (
            <div id="chat-reference-picker" role="group" aria-label="Choose an item to reference" className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-surface-darkBorder p-2 text-sm space-y-2">
              {picker.loading && <p role="status">Loading…</p>}
              {!picker.loading && picker.activities.length === 0 && picker.workouts.length === 0 && <p>Nothing to reference yet.</p>}
              {[['activity', 'Reference an activity', picker.activities], ['workout', 'Mention a workout', picker.workouts]].map(([type, label, items]) => items.length > 0 && (
                <div key={type}>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">{label}</p>
                  <ul>{items.map((it) => (
                    <li key={it.id}><button type="button" onClick={() => pick(type, it)} className="w-full text-left min-h-[44px] px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                      <span className="font-semibold">{it.title}</span> <span className="text-xs text-slate-600 dark:text-slate-300">{it.date}</span></button></li>
                  ))}</ul>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button type="button" onClick={togglePicker} aria-expanded={!!picker} aria-controls="chat-reference-picker" aria-describedby="chat-reference-hint" title="Reference an activity or mention a workout"
              className={`${adminBtn.secondary} shrink-0 !px-3`}><Icon name="plus" /><span className="sr-only">Reference an activity or mention a workout</span></button>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={MAX_MESSAGE_LENGTH} rows={2} placeholder="Write a message" aria-label="Message"
              className={`${adminInput} !py-2 resize-none`} />
            <button disabled={busy || (!body.trim() && !ref)} className={`${adminBtn.primary} shrink-0`}>Send</button>
          </div>
          <p id="chat-reference-hint" className="text-xs text-slate-600 dark:text-slate-300">Use + to reference one of the athlete's recent activities or mention a planned workout. It only adds a link card to your message — it does not link the activity to a workout or mark anything completed. Coaches see the athlete's activity in athlete context.</p>
        </form>
      ) : (
        <p className={`${adminCard} text-sm text-slate-700 dark:text-slate-200`}>This conversation is read-only because the coaching relationship has ended.</p>
      )}
    </div>
  )
}
