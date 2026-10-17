'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'
import { authorName } from '../lib/social'
import {
  groupRelationships,
  replacementWarning,
  fetchMyCoaching,
  acceptCoaching,
  declineCoaching,
  endCoaching,
  coachingErrorMessage,
} from '../lib/coaching'

const btn = 'px-3 py-1.5 rounded-lg text-[11px] font-bold border transition disabled:opacity-50'
const btnPrimary = `${btn} border-orange-500/40 text-orange-500 hover:bg-orange-500/10`
const btnQuiet = `${btn} border-slate-300 dark:border-slate-700 text-slate-500`

function Person({ id, profiles, children }) {
  const p = profiles.get(id)
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Avatar url={p?.avatar_url} name={authorName(p)} size="w-7 h-7" textSize="text-[10px]" />
      <Link href={`/riders/${id}`} className="text-xs font-bold text-slate-900 dark:text-white truncate hover:text-orange-500">
        {authorName(p)}
      </Link>
      {children}
    </div>
  )
}

function Row({ children, actions }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {children}
      <div className="flex gap-2 shrink-0">{actions}</div>
    </div>
  )
}

// Settings panel: "My coach" for riders and "My athletes" for coaches (any account can do both).
export default function CoachingPanel({ userId }) {
  const [rows, setRows] = useState([])
  const [profiles, setProfiles] = useState(new Map())
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  // Invite the rider is about to accept while having a coach: shown as an explicit confirmation.
  const [confirming, setConfirming] = useState(null)

  const load = useCallback(async () => {
    if (!userId) return
    const res = await fetchMyCoaching(supabase, userId)
    if (res.error) setError('Could not load coaching.')
    setRows(res.rows)
    setProfiles(res.profiles)
    setLoaded(true)
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  const run = async (id, action) => {
    setBusy(id)
    setError(null)
    const { error: err } = await action()
    if (err) setError(coachingErrorMessage(err))
    setConfirming(null)
    await load()
    setBusy(null)
  }

  const g = groupRelationships(rows, userId)
  const nameOf = (id) => authorName(profiles.get(id))
  const currentCoachName = g.coach ? nameOf(g.coach.coach_id) : null
  const empty =
    !g.coach && !g.athletes.length && !g.incomingInvites.length && !g.incomingRequests.length &&
    !g.outgoingInvites.length && !g.outgoingRequests.length

  const acceptInvite = (row) => {
    if (g.coach && confirming !== row.id) {
      setConfirming(row.id)
      return
    }
    run(row.id, () => acceptCoaching(supabase, row.id))
  }

  return (
    <div id="coaching" className="glass-dense p-4 rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder space-y-4 scroll-mt-20">
      <div>
        <h3 className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white">Coaching</h3>
        <p className="text-[11px] text-slate-500">
          A coach can read everything of yours, including private activities, power and heart-rate data, personal bests and
          your FTP, weight and lactate history. Privacy-zone locations stay hidden from them, and your e-mail and connection
          secrets are never shared. You can end access at any time. Find riders on the{' '}
          <Link href="/riders" className="underline">Riders</Link> page.
        </p>
      </div>

      {error && <p className="text-xs text-rose-500">{error}</p>}
      {!loaded && <p className="text-xs text-slate-400">Loading…</p>}
      {loaded && empty && <p className="text-xs text-slate-400">No coach and no athletes yet.</p>}

      {loaded && (
        <section className="space-y-2">
          <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-500">My coach</h4>
          {g.coach ? (
            <Row
              actions={
                <button
                  type="button"
                  disabled={busy === g.coach.id}
                  className={btnQuiet}
                  onClick={() => run(g.coach.id, () => endCoaching(supabase, g.coach.id))}
                >
                  Revoke access
                </button>
              }
            >
              <Person id={g.coach.coach_id} profiles={profiles} />
            </Row>
          ) : (
            <p className="text-[11px] text-slate-400">You have no coach. Open a rider's profile to request one.</p>
          )}

          {g.incomingInvites.map((row) => {
            const warning = replacementWarning({ currentCoachName, newCoachName: nameOf(row.coach_id) })
            return (
              <div key={row.id} className="space-y-1.5 rounded-xl border border-orange-500/30 p-2">
                <Row
                  actions={
                    <>
                      <button type="button" disabled={busy === row.id} className={btnPrimary} onClick={() => acceptInvite(row)}>
                        {confirming === row.id ? 'Replace my coach' : 'Accept'}
                      </button>
                      <button
                        type="button"
                        disabled={busy === row.id}
                        className={btnQuiet}
                        onClick={() => run(row.id, () => declineCoaching(supabase, row.id))}
                      >
                        Decline
                      </button>
                    </>
                  }
                >
                  <Person id={row.coach_id} profiles={profiles}>
                    <span className="text-[11px] text-slate-500">wants to coach you</span>
                  </Person>
                </Row>
                {warning && confirming === row.id && (
                  <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400" role="alert">{warning}</p>
                )}
                {warning && confirming !== row.id && (
                  <p className="text-[11px] text-slate-500">You already have a coach ({currentCoachName}); accepting replaces them.</p>
                )}
              </div>
            )
          })}

          {g.outgoingRequests.map((row) => (
            <Row
              key={row.id}
              actions={
                <button type="button" disabled={busy === row.id} className={btnQuiet} onClick={() => run(row.id, () => endCoaching(supabase, row.id))}>
                  Cancel request
                </button>
              }
            >
              <Person id={row.coach_id} profiles={profiles}>
                <span className="text-[11px] text-slate-500">request pending</span>
              </Person>
            </Row>
          ))}
        </section>
      )}

      {loaded && (
        <section className="space-y-2">
          <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-500">My athletes</h4>
          {!g.athletes.length && !g.incomingRequests.length && !g.outgoingInvites.length && (
            <p className="text-[11px] text-slate-400">You are not coaching anyone. Invite a rider from their profile.</p>
          )}
          {g.athletes.map((row) => (
            <Row
              key={row.id}
              actions={
                <>
                  <Link href={`/coach/${row.rider_id}/calendar`} className={btnPrimary}>Calendar</Link>
                  <button type="button" disabled={busy === row.id} className={btnQuiet} onClick={() => run(row.id, () => endCoaching(supabase, row.id))}>
                    End coaching
                  </button>
                </>
              }
            >
              <Person id={row.rider_id} profiles={profiles} />
            </Row>
          ))}
          {g.incomingRequests.map((row) => (
            <Row
              key={row.id}
              actions={
                <>
                  <button type="button" disabled={busy === row.id} className={btnPrimary} onClick={() => run(row.id, () => acceptCoaching(supabase, row.id))}>
                    Accept
                  </button>
                  <button type="button" disabled={busy === row.id} className={btnQuiet} onClick={() => run(row.id, () => declineCoaching(supabase, row.id))}>
                    Decline
                  </button>
                </>
              }
            >
              <Person id={row.rider_id} profiles={profiles}>
                <span className="text-[11px] text-slate-500">wants you as their coach</span>
              </Person>
            </Row>
          ))}
          {g.outgoingInvites.map((row) => (
            <Row
              key={row.id}
              actions={
                <button type="button" disabled={busy === row.id} className={btnQuiet} onClick={() => run(row.id, () => endCoaching(supabase, row.id))}>
                  Cancel invite
                </button>
              }
            >
              <Person id={row.rider_id} profiles={profiles}>
                <span className="text-[11px] text-slate-500">invite pending</span>
              </Person>
            </Row>
          ))}
        </section>
      )}
    </div>
  )
}
