'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { supabase } from '../lib/supabase'


<section className="bg-white dark:bg-surface-darkCard p-6 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
    <div className="flex justify-between items-center">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Recent Velodrome Sessions
        </h2>
        <button
            onClick={() => setIsWorkoutModalOpen(true)}
            className="text-xs font-bold text-emerald-600 dark:text-brand-neon hover:underline"
        >
            + Upload .FIT
        </button>
    </div>

    {activities.length === 0 ? (
        <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 text-sm">
            No sessions found. Click "+ Add Workout" to upload your first .FIT session.
        </div>
        ) : (
        <div className="space-y-3">
            {activities.slice(0, 8).map((act) => (
            <div
                key={act.id}
                className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 flex items-center justify-between"
            >
                <div>
                <div className="font-bold text-slate-900 dark:text-white text-sm">
                    {act.title}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                    {act.tracks?.name || 'Track Oval'} •{' '}
                    {new Date(act.activity_date).toLocaleDateString()}
                </div>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono font-bold">
                {act.max_power_w && (
                    <span className="text-emerald-500 dark:text-brand-neon">
                    {act.max_power_w} W
                    </span>
                )}
                {act.max_cadence_rpm && (
                    <span className="text-orange-500">
                    {act.max_cadence_rpm} RPM
                    </span>
                )}
                {act.chainring && act.cog && (
                    <span className="bg-slate-200 dark:bg-slate-800 px-2 py-1 rounded text-slate-700 dark:text-slate-300">
                    {act.chainring}×{act.cog}
                    </span>
                )}
                </div>
            </div>
            ))}
        </div>
        )}
</section>