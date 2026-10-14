'use client'

import BotBadge from './BotBadge'
import Link from 'next/link'
import Icon from './ActivityIcons'
import BadgePill from './BadgePill'
import RouteThumbnail from './RouteThumbnail'
import { BADGE_CONFIG, hydrateBadges } from '../lib/activityBadges'
import { VISIBILITY_OPTIONS, authorName } from '../lib/social'

// Left accent color by intensity factor.
function intensityAccent(intensityFactor) {
  if (!intensityFactor) return 'border-l-slate-300 dark:border-l-slate-700'
  if (intensityFactor >= 0.95) return 'border-l-rose-500'
  if (intensityFactor >= 0.75) return 'border-l-amber-500'
  return 'border-l-emerald-500'
}

function MetricPill({ icon, className, children }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${className}`}>
      <Icon name={icon} size={11} />
      {children}
    </span>
  )
}

function formatMovingTime(sec) {
  if (!sec) return null
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}m ${s < 10 ? '0' : ''}${s}s`
}

function formatDistance(meters) {
  if (!meters) return null
  return `${(meters / 1000).toFixed(1)} km`
}

function CoverPhoto({ cover }) {
  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cover.url} alt="Activity cover" loading="lazy" className="w-full h-full object-cover" />
      {cover.count > 1 && (
        <span className="absolute bottom-1 right-1 text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-950/70 text-white">
          +{cover.count - 1}
        </span>
      )}
    </div>
  )
}

function AuthorLine({ author }) {
  const name = authorName(author)
  return (
    <div className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
      {author.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={author.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
      ) : (
        <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-500 text-[10px] font-black flex items-center justify-center">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      {author.id ? (
        <Link href={`/riders/${author.id}`} className="hover:text-orange-500 transition">
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
          className="text-[10px] font-bold text-slate-400"
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
  onChangeVisibility,
  coverPhotos = null,
  title = 'Recent Sessions',
  emptyMessage = null,
  onAddWorkout,
  onDeleteActivity,
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

      <div className="space-y-3">
        {activities.map((act) => (
          <div
            key={act.id}
            className={`p-4 rounded-2xl border border-l-4 bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder ${intensityAccent(act.intensity_factor)} transition flex flex-col sm:flex-row items-stretch sm:items-center gap-4`}
          >
            <Link href={`/activities/${act.id}`} tabIndex={-1} className="block w-full h-24 sm:w-24 sm:h-24 shrink-0">
              {coverPhotos?.get(act.id)?.url ? (
                <CoverPhoto cover={coverPhotos.get(act.id)} />
              ) : (
                <RouteThumbnail preview={act.route_preview} className="w-full h-full" />
              )}
            </Link>

            <div className="space-y-1 flex-1 min-w-0">
              {!isOwnFeed && act.author && <AuthorLine author={act.author} />}
              {hydrateBadges(act.badges).length > 0 && <BadgeRow badges={hydrateBadges(act.badges)} />}
              <Link
                href={`/activities/${act.id}`}
                className="text-sm font-black text-slate-900 dark:text-white hover:text-orange-500 transition"
              >
                {act.title || 'Velodrome Session'}
              </Link>

              <div className="text-xs text-slate-400 flex items-center gap-3">
                <span>{new Date(act.activity_date || act.created_at).toLocaleDateString('en-US')}</span>
                {act.chainring && act.cog && (
                  <span className="inline-flex items-center gap-1"><Icon name="gear" size={11} />{act.chainring}×{act.cog}</span>
                )}
                {act.tracks?.name && (
                  <span className="inline-flex items-center gap-1"><Icon name="pin" size={11} />{act.tracks.name}</span>
                )}
              </div>

              {/* Quick metric badges (issue #11): only the ones the activity actually has */}
              {(act.distance_m || act.moving_time_s || act.avg_power_w || act.avg_hr) && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {formatDistance(act.distance_m) && (
                    <MetricPill icon="distance" className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                      {formatDistance(act.distance_m)}
                    </MetricPill>
                  )}
                  {formatMovingTime(act.moving_time_s) && (
                    <MetricPill icon="clock" className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                      {formatMovingTime(act.moving_time_s)}
                    </MetricPill>
                  )}
                  {act.avg_power_w && (
                    <MetricPill icon="power" className="bg-purple-500/10 text-purple-400">
                      {Math.round(act.avg_power_w)} W avg
                    </MetricPill>
                  )}
                  {act.avg_hr && (
                    <MetricPill icon="heart" className="bg-rose-500/10 text-rose-400">
                      {Math.round(act.avg_hr)} bpm avg
                    </MetricPill>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
              <Link
                href={`/activities/${act.id}`}
                className="py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 transition"
              >
                Detail →
              </Link>
              {isOwnFeed && onChangeVisibility && (
                <select
                  value={act.visibility || 'private'}
                  onChange={(e) => onChangeVisibility(act, e.target.value)}
                  aria-label="Who can see this activity"
                  title={VISIBILITY_OPTIONS.find((o) => o.value === (act.visibility || 'private'))?.hint}
                  className="py-2 px-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300"
                >
                  {VISIBILITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              {onDeleteActivity && isOwnFeed && (
                <button
                  type="button"
                  onClick={() => onDeleteActivity(act)}
                  aria-label="Delete activity"
                  className="py-2 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-xs font-bold text-rose-500 transition"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
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
