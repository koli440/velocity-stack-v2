'use client'

import Link from 'next/link'

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

export default function ActivityFeed({ activities = [], onAddWorkout }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white">
          Recent Sessions
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

      <div className="space-y-3">
        {activities.map((act) => (
          <div
            key={act.id}
            className="p-4 rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <Link
                href={`/activities/${act.id}`}
                className="text-sm font-black text-slate-900 dark:text-white hover:text-orange-500 transition"
              >
                {act.title || 'Velodrome Session'}
              </Link>

              <div className="text-xs text-slate-400 flex items-center gap-3">
                <span>{new Date(act.activity_date || act.created_at).toLocaleDateString('cs-CZ')}</span>
                {act.chainring && act.cog && (
                  <span>• Převod {act.chainring}×{act.cog}</span>
                )}
                {act.tracks?.name && <span>• {act.tracks.name}</span>}
              </div>

              {/* Rychlé metrikové štítky (issue #11): jen ty, které aktivita skutečně má */}
              {(act.distance_m || act.moving_time_s || act.avg_power_w || act.avg_hr) && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {formatDistance(act.distance_m) && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                      {formatDistance(act.distance_m)}
                    </span>
                  )}
                  {formatMovingTime(act.moving_time_s) && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                      {formatMovingTime(act.moving_time_s)}
                    </span>
                  )}
                  {act.avg_power_w && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
                      {Math.round(act.avg_power_w)} W avg
                    </span>
                  )}
                  {act.avg_hr && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400">
                      {Math.round(act.avg_hr)} bpm avg
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <Link
                href={`/activities/${act.id}`}
                className="py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 transition"
              >
                Detail →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
