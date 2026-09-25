'use client'

import { useState } from 'react'
import Link from 'next/link'
import ActivityWizardModal from './wizard/ActivityWizardModal'

export default function ActivityFeed({ activities = [], onAddWorkout, onActivityUpdated }) {
  const [selectedActivityForWizard, setSelectedActivityForWizard] = useState(null)

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
        {activities.map((act) => {
          const isWizardDone = act.wizard_completed

          return (
            <div
              key={act.id}
              className={`p-4 rounded-2xl border transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                !isWizardDone
                  ? 'bg-orange-500/[0.03] border-orange-500/30 dark:border-orange-500/20'
                  : 'bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/activities/${act.id}`}
                    className="text-sm font-black text-slate-900 dark:text-white hover:text-orange-500 transition"
                  >
                    {act.title || 'Velodrome Session'}
                  </Link>

                  {/* Odznak statusu Wizardu */}
                  {!isWizardDone ? (
                    <span className="text-[10px] font-black uppercase tracking-wider py-0.5 px-2 rounded-full bg-orange-500/10 text-orange-500 border border-orange-500/20 animate-pulse">
                      Nekategorizováno
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold py-0.5 px-2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                      {act.sport_type?.toUpperCase()} • {act.discipline}
                    </span>
                  )}
                </div>

                <div className="text-xs text-slate-400 flex items-center gap-3">
                  <span>{new Date(act.activity_date || act.created_at).toLocaleDateString('cs-CZ')}</span>
                  {act.chainring && act.cog && (
                    <span>• Převod {act.chainring}×{act.cog}</span>
                  )}
                  {act.tracks?.name && <span>• {act.tracks.name}</span>}
                </div>
              </div>

              {/* Tlačítka akcí */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedActivityForWizard(act)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    !isWizardDone
                      ? 'bg-orange-500 text-white hover:bg-orange-600 shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span>⚙️</span>
                  <span>{isWizardDone ? 'Edit Wizard' : 'Spustit Wizard'}</span>
                </button>

                <Link
                  href={`/activities/${act.id}`}
                  className="py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 transition"
                >
                  Detail →
                </Link>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modál průvodce */}
      {selectedActivityForWizard && (
        <ActivityWizardModal
          isOpen={!!selectedActivityForWizard}
          activity={selectedActivityForWizard}
          onClose={() => setSelectedActivityForWizard(null)}
          onCompleted={(updatedAct) => {
            if (onActivityUpdated) onActivityUpdated(updatedAct)
          }}
        />
      )}
    </div>
  )
}