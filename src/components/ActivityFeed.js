'use client'

import BotBadge from './BotBadge'
import { relativeDateTime, fullDateTime } from '../lib/dateFormat'
import CalendarTile from './CalendarTile'
import Avatar from './Avatar'
import Link from 'next/link'
import Icon from './ActivityIcons'
import TemplateRunsBadge from './TemplateRunsBadge'
import { fetchActivityRuns } from '../lib/activityTemplateRuns'
import BadgePill from './BadgePill'
import RaceBadge from './RaceBadge'
import HeroCardVisual from './HeroCardVisual'
import { BADGE_CONFIG, hydrateBadges } from '../lib/activityBadges'
import { authorName } from '../lib/social'
import { PREFETCH_ROOT_MARGIN, canAutoLoad, didLoadFail } from '../lib/infiniteScroll'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { currentReturnTo, withReturnTo } from '../lib/returnTo'
import { supabase } from '../lib/supabase'
import { fetchCommentInfo, fetchUnreadCounts, commentCountLabel } from '../lib/activityComments'
import { rideTypeHasGear } from '../lib/rideType'

// Intensity bar fill width (0-100%) driven by intensity_factor (IF ~1.0+ = full).
function intensityPct(intensityFactor) {
  if (!intensityFactor) return 0
  return Math.max(6, Math.min(100, Math.round(intensityFactor * 100)))
}

function Stat({ value, unit, tone }) {
  return (
    <div className="min-w-0">
      <b className={`block text-lg font-black tracking-tight leading-tight ${tone}`}>{value}</b>
      <span className="text-[9px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">{unit}</span>
    </div>
  )
}

function formatMovingTime(sec) {
  if (!sec) return null
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function formatDistance(meters) {
  if (!meters) return null
  return (meters / 1000).toFixed(1)
}

function CoverPhoto({ cover }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cover.url} alt="Activity cover" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
      {cover.count > 1 && (
        <span className="absolute bottom-2.5 right-2.5 z-[2] text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-950/70 text-white">
          +{cover.count - 1}
        </span>
      )}
    </>
  )
}

function AuthorLink({ author, children, className = '' }) {
  if (!author?.id) return <span className={className}>{children}</span>
  return (
    <Link href={`/riders/${author.id}`} className={`relative z-10 ${className}`}>
      {children}
    </Link>
  )
}

function BadgeRow({ badges }) {
  const visible = badges.slice(0, BADGE_CONFIG.maxVisible)
  const extra = badges.slice(BADGE_CONFIG.maxVisible)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((b) => (
        <BadgePill key={b.kind} badge={b} />
      ))}
      {extra.length > 0 && (
        <span
          title={extra.map((b) => b.label).join(', ')}
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-950/60 text-white"
        >
          +{extra.length}
        </span>
      )}
    </div>
  )
}

export default function ActivityFeed({
  activities = [],
  author: defaultAuthor = null,
  coverPhotos = null,
  title = 'Recent Sessions',
  emptyMessage = null,
  onAddWorkout,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  activityHref = (act) => `/activities/${act.id}`,
}) {
  const returnTo = currentReturnTo(usePathname())
  const sentinelRef = useRef(null)
  const latest = useRef({})
  const pending = useRef(null)
  const [supported] = useState(() => typeof IntersectionObserver !== 'undefined')
  const [hasFailed, setHasFailed] = useState(false)
  const count = activities.length
  const [commentCounts, setCommentCounts] = useState(new Map())
  const [unread, setUnread] = useState(new Map())
  const [runsByActivity, setRunsByActivity] = useState(new Map())
  const idsKey = activities.map((a) => a.id).join(',')

  // Comment counts come from one RPC per page of cards; a failure just hides the chip.
  useEffect(() => {
    if (!idsKey) return undefined
    let cancelled = false
    fetchCommentInfo(supabase, idsKey.split(',')).then(({ info }) => {
      if (cancelled) return
      setCommentCounts((prev) => {
        const next = new Map(prev)
        for (const [id, row] of info) next.set(id, row.comment_count)
        return next
      })
    })
    fetchActivityRuns(supabase, idsKey.split(',')).then((runs) => {
      if (cancelled) return
      setRunsByActivity((prev) => new Map([...prev, ...runs]))
    })
    fetchUnreadCounts(supabase, idsKey.split(',')).then(({ counts }) => {
      if (cancelled) return
      setUnread((prev) => {
        const next = new Map(prev)
        for (const id of idsKey.split(',')) next.set(id, counts.get(id) || 0)
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [idsKey])

  // Always expose the freshest props to the observer callback.
  latest.current = { hasMore, isLoadingMore, onLoadMore, count, hasFailed, supported }

  const triggerLoad = () => {
    const cur = latest.current
    if (!cur.onLoadMore || cur.isLoadingMore || pending.current) return
    const entry = { prevCount: cur.count, sawLoading: false }
    pending.current = entry
    setHasFailed(false)
    Promise.resolve()
      .then(() => cur.onLoadMore())
      .then(
        () => {
          if (!entry.sawLoading && pending.current === entry) pending.current = null
        },
        () => {
          if (pending.current === entry) pending.current = null
          setHasFailed(true)
        }
      )
  }

  // Settle a finished load: success clears the guard, an empty result flags failure.
  useEffect(() => {
    const entry = pending.current
    if (!entry) return
    if (isLoadingMore) {
      entry.sawLoading = true
    } else if (entry.sawLoading) {
      pending.current = null
      setHasFailed(didLoadFail({ prevCount: entry.prevCount, nextCount: count, hasMore }))
    }
  }, [isLoadingMore, count, hasMore])

  // Re-created whenever state changes so a still-visible sentinel re-fires and chains loads.
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !supported) return undefined
    if (!canAutoLoad({ hasMore, isLoadingMore, hasFailed, supported, inFlight: Boolean(pending.current), hasHandler: Boolean(onLoadMore) })) {
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        const cur = latest.current
        if (canAutoLoad({ ...cur, hasHandler: Boolean(cur.onLoadMore), inFlight: Boolean(pending.current) })) {
          triggerLoad()
        }
      },
      { rootMargin: PREFETCH_ROOT_MARGIN }
    )
    observer.observe(node)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, isLoadingMore, hasFailed, supported, count, onLoadMore])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white">
          {title}
        </h2>
        {onAddWorkout && (
          <button
            onClick={onAddWorkout}
            className="text-xs font-bold text-orange-500 hover:text-orange-600 transition"
          >
            + Manual Upload
          </button>
        )}
      </div>

      {activities.length === 0 && emptyMessage && (
        <p className="text-xs text-slate-400 py-6 text-center">{emptyMessage}</p>
      )}

      <div className="grid grid-cols-1 gap-4">
        {activities.map((act) => {
          const badges = hydrateBadges(act.badges)
          const cover = coverPhotos?.get(act.id)
          const dist = formatDistance(act.distance_m)
          const time = formatMovingTime(act.moving_time_s)
          const rider = act.author || defaultAuthor
          const riderName = authorName(rider)
          const when = act.activity_date || act.created_at
          const stats = [
            dist && { value: dist, unit: 'km' },
            time && { value: time, unit: 'time' },
            act.avg_power_w && { value: Math.round(act.avg_power_w), unit: 'W avg', tone: 'text-purple-700 dark:text-purple-300' },
            act.avg_power_w && act.weight_at_activity_kg && { value: (act.avg_power_w / act.weight_at_activity_kg).toFixed(2), unit: 'W/kg', tone: 'text-purple-700 dark:text-purple-300' },
            act.avg_hr && { value: Math.round(act.avg_hr), unit: 'bpm avg', tone: 'text-rose-700 dark:text-rose-300' },
          ].filter(Boolean)
          return (
            <div
              key={act.id}
              className="glass-card group relative overflow-hidden rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder hover:border-orange-500/60 hover:-translate-y-0.5 transition duration-200"
            >
              <div className="relative h-36 sm:h-40 bg-gradient-to-br from-teal-800 to-slate-900">
                {cover?.url ? (
                  <CoverPhoto cover={cover} />
                ) : (
                  <HeroCardVisual activity={act} className="absolute inset-0 w-full h-full p-3" />
                )}
                <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-slate-950/75 to-transparent pointer-events-none" />
                <CalendarTile date={when} className="absolute top-2.5 right-2.5 z-[2]" />
                {badges.length > 0 && (
                  <div className="absolute top-2.5 left-2.5 right-16 z-[2]">
                    <BadgeRow badges={badges} />
                  </div>
                )}
                {rider && (
                  <div className="absolute left-4 bottom-0 translate-y-1/2 z-10">
                    <AuthorLink author={rider} className="block rounded-full">
                      <Avatar url={rider.avatar_url} name={riderName} size="w-14 h-14" textSize="text-lg" className="ring-2 ring-orange-500 ring-offset-2 ring-offset-white dark:ring-offset-surface-darkCard" />
                    </AuthorLink>
                  </div>
                )}
              </div>

              <div className={`p-4 pb-3.5 ${rider ? 'pt-9' : ''}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    {rider && (
                      <div className="flex items-center gap-1.5 text-sm font-black text-slate-900 dark:text-white min-w-0">
                        <AuthorLink author={rider} className="truncate hover:text-orange-500 transition">{riderName}</AuthorLink>
                        {rider.is_bot && <BotBadge />}
                      </div>
                    )}
                    <div title={fullDateTime(when)} className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {relativeDateTime(when)}
                    </div>
                  </div>
                  <TemplateRunsBadge runs={runsByActivity.get(act.id)} />
                  {commentCounts.get(act.id) > 0 && (
                    <Link
                      href={withReturnTo(`${activityHref(act)}#comments`, returnTo)}
                      data-testid="comment-count-chip"
                      aria-label={commentCountLabel(commentCounts.get(act.id))}
                      className="relative z-10 shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-orange-500"
                    >
                      <Icon name="chat" size={11} /> {commentCounts.get(act.id)}
                      {unread.get(act.id) > 0 && (
                        <span
                          data-testid="comment-unread-dot"
                          title="New comments"
                          aria-label="New comments"
                          className="ml-1 inline-block w-2 h-2 rounded-full bg-orange-500 align-middle"
                        />
                      )}
                    </Link>
                  )}
                </div>
                <Link
                  href={withReturnTo(activityHref(act), returnTo)}
                  className="mt-2 block text-base font-black text-slate-900 dark:text-white group-hover:text-orange-500 transition after:absolute after:inset-0 after:content-['']"
                >
                  {act.title || 'Velodrome Session'}
                </Link>
                {act.is_race === true && <div className="mt-1"><RaceBadge testId="feed-race-tag" /></div>}

                {(act.tracks?.name || (rideTypeHasGear(act.ride_type) && act.chainring && act.cog)) && (
                  <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-3">
                    {act.tracks?.name && <span>{act.tracks.name}</span>}
                    {rideTypeHasGear(act.ride_type) && act.chainring && act.cog && (
                      <span className="inline-flex items-center gap-1"><Icon name="gear" size={11} />{act.chainring}×{act.cog}</span>
                    )}
                  </div>
                )}

                {stats.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200 dark:border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-900 dark:text-white">
                    {stats.map((st) => (
                      <Stat key={st.unit} {...st} />
                    ))}
                  </div>
                )}

                <div className="mt-3 h-[3px] rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500"
                    style={{ width: `${intensityPct(act.intensity_factor)}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {hasMore && onLoadMore && (
        <div ref={sentinelRef} className="flex flex-col items-center gap-2 pt-2" data-testid="feed-sentinel">
          {isLoadingMore && supported && !hasFailed && (
            <span className="text-xs text-slate-400" role="status">Loading…</span>
          )}
          {(!supported || hasFailed) && (
            <button
              type="button"
              onClick={() => {
                if (!isLoadingMore) triggerLoad()
              }}
              disabled={isLoadingMore}
              className="py-2 px-4 rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 transition disabled:opacity-50"
            >
              {isLoadingMore ? 'Loading…' : hasFailed ? 'Retry loading more' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
