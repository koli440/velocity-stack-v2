'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Portal from './Portal'
import { supabase } from '../lib/supabase'
import { authorName } from '../lib/social'
import {
  COMMENT_MAX_LENGTH,
  activeMentionQuery,
  shouldFetchMentions,
  mentionStatusText,
  popoverPlacement,
  addActivityComment,
  applyMention,
  commentCountLabel,
  commentErrorMessage,
  commentLength,
  deleteActivityComment,
  editActivityComment,
  fetchActivityComments,
  fetchCommentInfo,
  isValidCommentBody,
  markCommentsRead,
  relativeTime,
  reportActivityComment,
  searchMentionCandidates,
  setCommentsEnabled,
  splitCommentBody,
  subscribeActivityComments,
} from '../lib/activityComments'
import Avatar from './Avatar'
import BotBadge from './BotBadge'
import useContextHref from './useContextHref'

const COUNTER_WARN_AT = 1800

// Composer textarea with Enter-to-send (Shift+Enter = new line), a character counter and
// @mention autocomplete limited to riders who can see the activity.
function Composer({ activityId, initialValue = '', submitLabel, busy, error, onSubmit, onCancel, autoFocus = false }) {
  const [value, setValue] = useState(initialValue)
  const [caret, setCaret] = useState(initialValue.length)
  const [candidates, setCandidates] = useState([])
  const [mentionStatus, setMentionStatus] = useState('idle')
  const [highlight, setHighlight] = useState(0)
  const textareaRef = useRef(null)
  const [placement, setPlacement] = useState(null)
  const mention = activeMentionQuery(value, caret)
  const mentionQuery = mention ? mention.query : null
  const length = commentLength(value)
  const valid = isValidCommentBody(value)

  useEffect(() => {
    if (!shouldFetchMentions(mentionQuery)) {
      setCandidates([])
      setMentionStatus('idle')
      return undefined
    }
    let cancelled = false
    setMentionStatus('loading')
    const timer = setTimeout(async () => {
      const { candidates: rows, error: searchError } = await searchMentionCandidates(supabase, { activityId, query: mentionQuery })
      if (cancelled) return
      setMentionStatus(searchError ? 'error' : 'ready')
      setCandidates(rows)
      setHighlight(0)
    }, mentionQuery === '' ? 0 : 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activityId, mentionQuery])

  const popoverOpen = Boolean(mention) && mentionStatus !== 'idle'
  useEffect(() => {
    if (!popoverOpen) return undefined
    const update = () => {
      const el = textareaRef.current
      if (!el) return
      setPlacement(popoverPlacement(el.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }))
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [popoverOpen, candidates.length])

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  const pick = (candidate) => {
    const next = applyMention(value, mention, caret, candidate.handle || candidate.nickname)
    setValue(next.text)
    setCandidates([])
    setMentionStatus('idle')
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
      setCaret(next.caret)
    })
  }

  const submit = async () => {
    if (!valid || busy) return
    const ok = await onSubmit(value)
    if (ok) {
      setValue('')
      setCaret(0)
    }
  }

  const onKeyDown = (e) => {
    if (candidates.length > 0 && mention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => (h + 1) % candidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => (h - 1 + candidates.length) % candidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(candidates[highlight])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setCandidates([])
        return
      }
    }
    if (e.key === 'Escape' && onCancel) {
      onCancel()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          rows={initialValue ? 3 : 2}
          maxLength={COMMENT_MAX_LENGTH + 200}
          placeholder="Write a comment… use @ to mention a rider"
          aria-label="Comment"
          data-testid="comment-input"
          onChange={(e) => {
            setValue(e.target.value)
            setCaret(e.target.selectionStart ?? e.target.value.length)
          }}
          onSelect={(e) => setCaret(e.target.selectionStart ?? value.length)}
          onKeyDown={onKeyDown}
          disabled={busy}
          className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-orange-500 disabled:opacity-60"
        />
        {popoverOpen && placement && (
          <Portal>
            <div
              data-testid="mention-popover"
              style={{ position: 'fixed', zIndex: 80, ...placement }}
              className="overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg"
            >
              {candidates.length === 0 ? (
                <div role="status" data-testid="mention-status" className="px-3 py-2 text-xs text-slate-500">
                  {mentionStatusText(mentionStatus)}
                </div>
              ) : (
                <ul role="listbox" aria-label="Mention suggestions">
                  {candidates.map((c, i) => (
                    <li key={c.id} role="option" aria-selected={i === highlight}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          pick(c)
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs ${i === highlight ? 'bg-orange-500/10' : ''}`}
                      >
                        <Avatar url={c.avatar_url} name={c.display_name || c.nickname} size="w-5 h-5" textSize="text-[9px]" />
                        <span className="font-bold text-slate-900 dark:text-white">@{c.handle || c.nickname}</span>
                        {c.display_name && c.display_name !== (c.handle || c.nickname) && (
                          <span className="text-slate-500 truncate">{c.display_name}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Portal>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span
          data-testid="comment-counter"
          className={`text-[10px] font-bold ${length > COMMENT_MAX_LENGTH ? 'text-rose-500' : length >= COUNTER_WARN_AT ? 'text-amber-500' : 'text-slate-400'}`}
        >
          {length}/{COMMENT_MAX_LENGTH}
        </span>
        {error && <span role="alert" className="text-[11px] text-rose-500">{error}</span>}
        <div className="ml-auto flex items-center gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!valid || busy}
            data-testid="comment-submit"
            className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-black disabled:opacity-40 transition"
          >
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function CommentBody({ body, mentions, href }) {
  const parts = splitCommentBody(body, mentions)
  return (
    <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
      {parts.map((p, i) =>
        p.type === 'mention' ? (
          <Link key={i} href={href(`/riders/${p.userId}`)} className="font-bold text-orange-500 hover:underline">
            {p.text}
          </Link>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </p>
  )
}

// Comment thread of one activity (flat stream). Rendered on the activity detail page for
// the owner, the coach (athlete context) and every rider who can see the activity.
export default function ActivityComments({ activityId }) {
  const href = useContextHref()
  const [userId, setUserId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [info, setInfo] = useState(null)
  const [comments, setComments] = useState([])
  const [profiles, setProfiles] = useState(new Map())
  const [mentions, setMentions] = useState(new Map())
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')
  const [rowError, setRowError] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!activityId) return
    setLoadError(false)
    const [{ info: infoMap, error: infoError }, list] = await Promise.all([
      fetchCommentInfo(supabase, [activityId]),
      fetchActivityComments(supabase, activityId),
    ])
    if (infoError || list.error) {
      setLoadError(true)
    } else {
      setInfo(infoMap.get(activityId) || null)
      setComments(list.comments)
      setProfiles(list.profiles)
      setMentions(list.mentions)
    }
    setLoading(false)
  }, [activityId])

  useEffect(() => {
    setLoading(true)
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null))
    load()
  }, [load])

  // Live updates: reload on any change (RLS filters what arrives); a reload also covers
  // comments we just posted ourselves, so nothing is duplicated.
  useEffect(() => {
    if (!activityId) return undefined
    let timer = null
    const unsubscribe = subscribeActivityComments(supabase, activityId, () => {
      clearTimeout(timer)
      timer = setTimeout(load, 200)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [activityId, load])

  // Opening the thread (and every live update while it is open) marks it as read.
  const loaded = !loading && !loadError && !!info
  useEffect(() => {
    if (loaded) markCommentsRead(supabase, activityId)
  }, [loaded, activityId, comments.length])

  // Scroll to the thread when opened from a notification (#comments).
  useEffect(() => {
    if (!loading && typeof window !== 'undefined' && window.location.hash === '#comments') {
      document.getElementById('comments')?.scrollIntoView({ block: 'start' })
    }
  }, [loading])

  const post = async (body) => {
    setPosting(true)
    setPostError('')
    const { error } = await addActivityComment(supabase, { activityId, body })
    setPosting(false)
    if (error) {
      setPostError(commentErrorMessage(error))
      return false
    }
    await load()
    return true
  }

  const saveEdit = async (comment, body) => {
    setEditBusy(true)
    setEditError('')
    const { error } = await editActivityComment(supabase, { commentId: comment.id, body })
    setEditBusy(false)
    if (error) {
      setEditError(commentErrorMessage(error))
      return false
    }
    setEditingId(null)
    await load()
    return true
  }

  const report = async (comment) => {
    const reason = window.prompt('Why are you reporting this comment? (optional)')
    if (reason === null) return
    setRowError('')
    const { error } = await reportActivityComment(supabase, { commentId: comment.id, reason })
    if (error) {
      setRowError(commentErrorMessage(error))
      return
    }
    setNotice('Thanks, the comment was reported to the moderators.')
  }

  const toggleComments = async () => {
    setRowError('')
    setNotice('')
    const { error } = await setCommentsEnabled(supabase, { activityId, enabled: !info.comments_enabled })
    if (error) {
      setRowError(commentErrorMessage(error))
      return
    }
    await load()
  }

  const remove = async (comment) => {
    if (!window.confirm('Delete this comment?')) return
    setDeletingId(comment.id)
    setRowError('')
    const { error } = await deleteActivityComment(supabase, { commentId: comment.id })
    setDeletingId(null)
    if (error) {
      setRowError(commentErrorMessage(error))
      return
    }
    await load()
  }

  if (loading) {
    return (
      <section id="comments" aria-busy="true" className="space-y-3" data-testid="comments-loading">
        <div className="h-4 w-32 rounded bg-slate-100 dark:bg-slate-900/60 animate-pulse" />
        <div className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-900/60 animate-pulse" />
      </section>
    )
  }

  if (loadError) {
    return (
      <section id="comments" className="rounded-2xl border border-slate-200 dark:border-surface-darkBorder p-4 text-xs">
        <span className="text-rose-500">Comments could not be loaded.</span>{' '}
        <button type="button" onClick={() => { setLoading(true); load() }} className="font-bold underline">
          Retry
        </button>
      </section>
    )
  }

  // Not visible to the viewer (hidden or blocked): never reveal that comments exist.
  if (!info) return null

  const isOwner = !!userId && userId === info.owner_id
  const canWrite = info.comments_enabled

  return (
    <section
      id="comments"
      data-testid="activity-comments"
      className="glass-card rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder p-4 space-y-4 scroll-mt-20"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white">
          Comments <span className="text-slate-400 font-bold normal-case text-xs">{commentCountLabel(comments.length)}</span>
        </h2>
        {isOwner && (
          <button
            type="button"
            onClick={toggleComments}
            data-testid="comments-toggle"
            className="ml-auto text-[11px] font-bold text-slate-500 hover:text-orange-500"
          >
            {info.comments_enabled ? 'Turn comments off' : 'Turn comments on'}
          </button>
        )}
      </div>

      {comments.length === 0 && (
        <p className="text-xs text-slate-400" data-testid="comments-empty">
          {info.comments_enabled ? 'No comments yet. Start the conversation.' : 'No comments.'}
        </p>
      )}

      {comments.length > 0 && (
        <ul className="space-y-4">
          {comments.map((c) => {
            const author = profiles.get(c.user_id)
            const name = authorName(author)
            const mine = c.user_id === userId
            const isCoach = !!info.coach_id && c.user_id === info.coach_id
            return (
              <li key={c.id} className="flex gap-2.5" data-testid="comment">
                <Avatar url={author?.avatar_url} name={name} size="w-8 h-8" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    {c.user_id ? (
                      <Link href={href(`/riders/${c.user_id}`)} className="font-black text-slate-900 dark:text-white hover:text-orange-500">
                        {name}
                      </Link>
                    ) : (
                      <span className="font-black">{name}</span>
                    )}
                    {author?.is_bot && <BotBadge />}
                    {isCoach && (
                      <span
                        data-testid="comment-coach-badge"
                        className="px-1.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold"
                      >
                        Coach
                      </span>
                    )}
                    <time dateTime={c.created_at} title={new Date(c.created_at).toLocaleString()} className="text-slate-400">
                      {relativeTime(c.created_at)}
                    </time>
                    {c.edited_at && <span className="text-slate-400 italic">edited</span>}
                  </div>

                  {editingId === c.id ? (
                    <Composer
                      activityId={activityId}
                      initialValue={c.body}
                      submitLabel="Save"
                      busy={editBusy}
                      error={editError}
                      autoFocus
                      onSubmit={(body) => saveEdit(c, body)}
                      onCancel={() => { setEditingId(null); setEditError('') }}
                    />
                  ) : (
                    <CommentBody body={c.body} mentions={mentions.get(c.id)} href={href} />
                  )}

                  {editingId !== c.id && (
                    <div className="flex gap-3 text-[11px] font-bold text-slate-400">
                      {!mine && (
                        <button type="button" onClick={() => report(c)} className="hover:text-rose-500">
                          Report
                        </button>
                      )}
                    </div>
                  )}
                  {editingId !== c.id && (mine || isOwner) && (
                    <div className="flex gap-3 text-[11px] font-bold text-slate-400">
                      {mine && (
                        <button type="button" onClick={() => { setEditingId(c.id); setEditError('') }} className="hover:text-orange-500">
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(c)}
                        disabled={deletingId === c.id}
                        className="hover:text-rose-500 disabled:opacity-50"
                      >
                        {deletingId === c.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {rowError && <p role="alert" className="text-[11px] text-rose-500">{rowError}</p>}
      {notice && <p role="status" className="text-[11px] text-emerald-600">{notice}</p>}

      {canWrite ? (
        <Composer
          activityId={activityId}
          submitLabel="Comment"
          busy={posting}
          error={postError}
          onSubmit={post}
        />
      ) : (
        <p className="text-xs text-slate-500 rounded-xl bg-slate-50 dark:bg-slate-900/60 px-3 py-2" data-testid="comments-readonly">
          {isOwner ? 'Comments are turned off. Existing comments stay visible to riders who can see this activity.' : 'Comments are turned off for this activity.'}
        </p>
      )}
    </section>
  )
}
