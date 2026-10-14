'use client'

import BotBadge from './BotBadge'
import { formatDate } from '../lib/dateFormat'
import Avatar from './Avatar'
import Link from 'next/link'
import Icon from './ActivityIcons'
import BadgePill from './BadgePill'
import RouteThumbnail from './RouteThumbnail'
import { BADGE_CONFIG, hydrateBadges } from '../lib/activityBadges'
import { authorName } from '../lib/social'

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

function AuthorLine({ author }) {
  const name = authorName(author)
  return (
    <div className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 min-w-0">
      <Avatar url={author.avatar_url} name={name} size="w-5 h-5" textSize="text-[10px]" />
      {author.id ? (
        <Link href={`/riders/${author.id}`} className="relative z-10 hover:text-orange-500 transition">
          {name}
        </Link>
      ) : (
        name
      )}
      {author.is_bot && <BotBadge />}
    </div>
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
  isOwnFeed = true,
  coverPhotos = null,
  title = 'Recent Sessions',
  emptyMessage = null,
  onAddWorkout,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}) {
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
          const stats = [
            dist && { value: dist, unit: 'km' },
            time && { value: time, unit: 'time' },
            act.avg_power_w && { value: Math.round(act.avg_power_w), unit: 'W avg', tone: 'text-purple-700 dark:text-purple-300' },
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
                  <RouteThumbnail hero preview={act.route_preview} className="absolute inset-0 w-full h-full p-3" />
                )}
                <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-slate-950/75 to-transparent pointer-events-none" />
                {badges.length > 0 && (
                  <div className="absolute top-2.5 left-2.5 right-2.5 z-[2]">
                    <BadgeRow badges={badges} />
                  </div>
                )}
              </div>

              <div className="p-4 pb-3.5">
                {(
                  <div className="flex items-center gap-2">
                    {!isOwnFeed && act.author && <AuthorLine author={act.author} />}
                    <span className="ml-auto shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {formatDate(act.activity_date || act.created_at)}
                    </span>
                  </div>
                )}
                <Link
                  href={`/activities/${act.id}`}
                  className="mt-2 block text-base font-black text-slate-900 dark:text-white group-hover:text-orange-500 transition after:absolute after:inset-0 after:content-['']"
                >
                  {act.title || 'Velodrome Session'}
                </Link>

                {(act.tracks?.name || (act.chainring && act.cog)) && (
                  <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-3">
                    {act.tracks?.name && <span>{act.tracks.name}</span>}
                    {act.chainring && act.cog && (
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
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="py-2 px-4 rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 transition disabled:opacity-50"
          >
            {isLoadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
