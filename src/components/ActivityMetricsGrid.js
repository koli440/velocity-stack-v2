'use client'

// Kompletní sada metrik aktivity (issue #11): čas, vzdálenost, výkon (vč. průměrů v různých
// oknech), tepová frekvence, kadence, točivý moment, převýšení a zátěžové ukazatele.
//
// issue #20: Peak Power, Peak Torque, Max Cadence a Max Speed se dříve zobrazovaly i v
// BenchmarkCards (historické srovnání), takže se duplikovaly a plýtvaly místem. Zde je
// proto nezobrazujeme znovu a layout je kompaktnější.
//
// issue #17: uživatel si může jednotlivé metriky skrýt přes menu "Manage metrics". Výběr
// se ukládá do sloupce profiles.hidden_activity_metrics (stejné místo jako ostatní
// uživatelské preference - theme_preference, ftp_w, ...), ne do localStorage.

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

function formatDuration(totalSeconds) {
  if (totalSeconds == null) return '—'
  const s = Math.round(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function formatDistance(meters) {
  if (meters == null) return '—'
  return `${(meters / 1000).toFixed(2)} km`
}

function formatValue(value, unit, decimals = 0) {
  if (value == null) return '—'
  const num = decimals > 0 ? Number(value).toFixed(decimals) : Math.round(value)
  return `${num} ${unit}`
}

function MetricCard({ label, value, hint }) {
  return (
    <div className="p-3 rounded-xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder space-y-0.5">
      <span className="text-[10px] uppercase font-bold text-slate-400 block">{label}</span>
      <div className="text-base font-black text-slate-900 dark:text-white">{value}</div>
      {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
    </div>
  )
}

// Pro aktivity bez rychlostního senzoru indikujeme přímo pod metrikou, jak byla rychlost/
// vzdálenost dopočítána - viz issue #12 diskuze (fixed-gear kadence vs. GPS vs. road bike
// s volnoběhem). Kompaktní "hint" pod hodnotou je přesnější i úspornější než jeden velký
// badge v hlavičce stránky.
const SPEED_SOURCE_HINTS = {
  sensor: 'Rychlostní senzor',
  gps: 'Odhad z GPS',
  derived_from_cadence: 'Odhad z kadence',
  unavailable: 'Data nejsou k dispozici',
}

function speedSourceHint(speedSource) {
  return SPEED_SOURCE_HINTS[speedSource]
}

export default function ActivityMetricsGrid({ activity, curvesMap = {} }) {
  const powerCurve = useMemo(() => curvesMap?.Power || {}, [curvesMap])
  const powerWindows = ['15s', '30s', '1m', '5m', '15m', '30m']

  const startTime = activity?.start_time || activity?.activity_date
  const hasFtp = activity?.intensity_factor != null && activity?.training_load != null
  const speedHint = speedSourceHint(activity?.speed_source)

  const [userId, setUserId] = useState(null)
  const [hiddenIds, setHiddenIds] = useState([])
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Načtení přihlášeného uživatele a jeho uložené preference skrytých metrik z profiles.
  useEffect(() => {
    let cancelled = false

    const loadPreference = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (cancelled || !user) return

      setUserId(user.id)

      const { data } = await supabase
        .from('profiles')
        .select('hidden_activity_metrics')
        .eq('id', user.id)
        .maybeSingle()

      if (!cancelled && Array.isArray(data?.hidden_activity_metrics)) {
        setHiddenIds(data.hidden_activity_metrics)
      }
    }

    loadPreference()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleMetric = async (id) => {
    const next = hiddenIds.includes(id) ? hiddenIds.filter((x) => x !== id) : [...hiddenIds, id]
    setHiddenIds(next)

    if (!userId) return
    const { error } = await supabase
      .from('profiles')
      .update({ hidden_activity_metrics: next, updated_at: new Date().toISOString() })
      .eq('id', userId)

    if (error) {
      console.warn('Nepodařilo se uložit preferenci skrytých metrik:', error.message)
    }
  }

  // Ploché pole definic metrik - umožňuje jednoduché filtrování podle skrytých ID
  // a zároveň jediné místo, kde se definuje "co je metrika" (pro menu i render).
  const metrics = useMemo(() => {
    return [
      {
        id: 'start_time',
        group: 'Time & Distance',
        label: 'Start Time',
        value: startTime
          ? new Date(startTime).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
          : '—',
      },
      { id: 'distance', group: 'Time & Distance', label: 'Distance', value: formatDistance(activity?.distance_m), hint: speedHint },
      { id: 'moving_time', group: 'Time & Distance', label: 'Moving Time', value: formatDuration(activity?.moving_time_s), hint: speedHint },
      { id: 'elapsed_time', group: 'Time & Distance', label: 'Elapsed Time', value: formatDuration(activity?.elapsed_time_s) },
      { id: 'avg_speed', group: 'Time & Distance', label: 'Avg Speed', value: formatValue(activity?.avg_speed_kmh, 'km/h', 1), hint: speedHint },
      // max_speed_kmh je vynechán - už je vidět jako "Top Speed" v BenchmarkCards (issue #20)

      { id: 'avg_power', group: 'Power', label: 'Avg Power', value: formatValue(activity?.avg_power_w, 'W') },
      { id: 'normalized_power', group: 'Power', label: 'Normalized Power', value: formatValue(activity?.normalized_power_w, 'W') },
      // max_power_w je vynechán - už je vidět jako "Max Watts" v BenchmarkCards (issue #20)
      ...powerWindows.map((win) => ({
        id: `avg_power_${win}`,
        group: 'Power',
        label: `Avg Power @${win}`,
        value: formatValue(powerCurve[win], 'W'),
      })),

      {
        id: 'intensity_factor',
        group: 'Load',
        label: 'Intensity Factor',
        value: hasFtp ? activity.intensity_factor.toFixed(2) : '—',
        hint: !hasFtp ? 'Set FTP in profile' : undefined,
      },
      {
        id: 'training_load',
        group: 'Load',
        label: 'Training Load',
        value: hasFtp ? Math.round(activity.training_load) : '—',
        hint: !hasFtp ? 'Set FTP in profile' : undefined,
      },
      { id: 'elevation_gain', group: 'Load', label: 'Elevation Gain', value: formatValue(activity?.elevation_gain_m, 'm') },
      { id: 'elevation_loss', group: 'Load', label: 'Elevation Loss', value: formatValue(activity?.elevation_loss_m, 'm') },

      { id: 'avg_hr', group: 'Heart Rate & Cadence', label: 'Avg HR', value: formatValue(activity?.avg_hr, 'bpm') },
      { id: 'max_hr', group: 'Heart Rate & Cadence', label: 'Max HR', value: formatValue(activity?.max_hr, 'bpm') },
      { id: 'avg_cadence', group: 'Heart Rate & Cadence', label: 'Avg Cadence', value: formatValue(activity?.avg_cadence_rpm, 'RPM') },
      // max_cadence_rpm je vynechán - už je vidět jako "Cadence Peak" v BenchmarkCards (issue #20)
      { id: 'avg_torque', group: 'Heart Rate & Cadence', label: 'Avg Torque', value: formatValue(activity?.avg_torque_nm, 'Nm', 1) },
      // peak_torque_nm je vynechán - už je vidět jako "Peak Torque" v BenchmarkCards (issue #20)
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, hasFtp, powerCurve, speedHint, startTime])

  if (!activity) return null

  const visibleMetrics = metrics.filter((m) => !hiddenIds.includes(m.id))
  const groups = []
  visibleMetrics.forEach((m) => {
    let group = groups.find((g) => g.name === m.group)
    if (!group) {
      group = { name: m.group, items: [] }
      groups.push(group)
    }
    group.items.push(m)
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
          <span>📊</span> Activity Metrics
        </h3>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="py-1.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-[10px] uppercase tracking-wider transition flex items-center gap-1.5"
          >
            <span>⚙️</span> Manage Metrics
            {hiddenIds.length > 0 && (
              <span className="text-[9px] font-black py-0.5 px-1.5 rounded-full bg-orange-500/10 text-orange-500">
                {hiddenIds.length} hidden
              </span>
            )}
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-64 max-h-80 overflow-y-auto rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder shadow-lg z-20 p-2 space-y-1">
              {metrics.map((m) => {
                const isHidden = hiddenIds.includes(m.id)
                return (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-xs"
                  >
                    <input type="checkbox" checked={!isHidden} onChange={() => toggleMetric(m.id)} className="rounded" />
                    <span className={isHidden ? 'text-slate-400' : 'text-slate-800 dark:text-slate-200 font-semibold'}>
                      {m.label}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {groups.length === 0 && (
        <p className="text-xs text-slate-400 italic">Všechny metriky jsou skryté. Odkryjte je přes „Manage Metrics“.</p>
      )}

      {groups.map((group) => (
        <div key={group.name} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {group.items.map((m) => (
            <MetricCard key={m.id} label={m.label} value={m.value} hint={m.hint} />
          ))}
        </div>
      ))}
    </div>
  )
}
