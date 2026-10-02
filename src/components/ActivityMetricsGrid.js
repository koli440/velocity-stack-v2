'use client'

// Kompletní sada metrik aktivity (issue #11): čas, vzdálenost, výkon (vč. průměrů v různých
// oknech), tepová frekvence, kadence, točivý moment, převýšení a zátěžové ukazatele.
//
// issue #20: metriky už dříve duplikoval samostatný BenchmarkCards blok nad touto mřížkou
// (Peak Power/Max Watts, Max Cadence/Cadence Peak, Peak Torque, Max Speed/Top Speed).
// Namísto dvou vizuálně podobných sekcí vedle sebe je srovnání s historickým maximem (PB)
// teď součástí příslušné karty zde (badge + hint), BenchmarkCards sekce byla odstraněna.
// Skupiny metrik jsou navíc barevně odlišené (barva popisku + levý okraj karty), aby se
// v kompaktní mřížce dalo rychleji orientovat.
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

// Barevné odlišení skupin metrik - stejná paleta jako dřívější BenchmarkCards
// (fialová pro výkon, jantarová pro točivý moment/zátěž, nebeská pro rychlost/čas).
const GROUP_COLORS = {
  'Time & Distance': { border: 'border-l-sky-400', label: 'text-sky-500 dark:text-sky-400' },
  Power: { border: 'border-l-purple-400', label: 'text-purple-500 dark:text-purple-400' },
  Load: { border: 'border-l-amber-400', label: 'text-amber-500 dark:text-amber-400' },
  'Heart Rate & Cadence': { border: 'border-l-rose-400', label: 'text-rose-500 dark:text-rose-400' },
}
const DEFAULT_GROUP_COLOR = { border: 'border-l-slate-300 dark:border-l-slate-700', label: 'text-slate-400' }

function MetricCard({ label, value, hint, badge, accent = DEFAULT_GROUP_COLOR }) {
  return (
    <div
      className={`p-3 rounded-xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder border-l-4 ${accent.border} space-y-0.5`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[10px] uppercase font-bold block ${accent.label}`}>{label}</span>
        {badge}
      </div>
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

// Badge porovnávající aktuální hodnotu s historickým maximem jezdce (dříve BenchmarkCards).
// Nový All-time PB -> zelený badge, jinak procento z osobního maxima.
function pbBadge(current, master) {
  if (current == null || master == null) return null
  const pct = Math.round((current / master) * 100)
  const isPB = current >= master

  if (isPB) {
    return (
      <span className="text-[9px] font-black py-0.5 px-1.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 whitespace-nowrap">
        🏆 PB
      </span>
    )
  }

  return (
    <span className="text-[9px] font-bold py-0.5 px-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 whitespace-nowrap">
      {pct}% PB
    </span>
  )
}

function pbHint(master, unit) {
  return master != null ? `Historické max.: ${master} ${unit}` : undefined
}

export default function ActivityMetricsGrid({ activity, curvesMap = {}, masterCurves = {} }) {
  const powerCurve = useMemo(() => curvesMap?.Power || {}, [curvesMap])
  const powerWindows = ['15s', '30s', '1m', '5m', '15m', '30m']

  const startTime = activity?.start_time || activity?.activity_date
  const hasFtp = activity?.intensity_factor != null && activity?.training_load != null
  const speedHint = speedSourceHint(activity?.speed_source)

  // Historická maxima pro srovnávací badge (viz dříve BenchmarkCards)
  const powerMaster5s = masterCurves?.Power?.['5s'] ?? null
  const cadenceMaster1s = masterCurves?.Cadence?.['1s'] ?? null
  const speedMaster5s = masterCurves?.Speed?.['5s'] ?? null
  const torqueMaster1s = masterCurves?.Torque?.['1s'] ?? null

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
      {
        id: 'max_speed',
        group: 'Time & Distance',
        label: 'Max Speed',
        value: formatValue(activity?.max_speed_kmh, 'km/h', 1),
        hint: pbHint(speedMaster5s, 'km/h') || speedHint,
        badge: pbBadge(activity?.max_speed_kmh, speedMaster5s),
      },

      { id: 'avg_power', group: 'Power', label: 'Avg Power', value: formatValue(activity?.avg_power_w, 'W') },
      { id: 'normalized_power', group: 'Power', label: 'Normalized Power', value: formatValue(activity?.normalized_power_w, 'W') },
      {
        id: 'max_power',
        group: 'Power',
        label: 'Peak Power',
        value: formatValue(activity?.max_power_w, 'W'),
        hint: pbHint(powerMaster5s, 'W'),
        badge: pbBadge(activity?.max_power_w, powerMaster5s),
      },
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
      {
        id: 'max_cadence',
        group: 'Heart Rate & Cadence',
        label: 'Max Cadence',
        value: formatValue(activity?.max_cadence_rpm, 'RPM'),
        hint: pbHint(cadenceMaster1s, 'RPM'),
        badge: pbBadge(activity?.max_cadence_rpm, cadenceMaster1s),
      },
      { id: 'avg_torque', group: 'Heart Rate & Cadence', label: 'Avg Torque', value: formatValue(activity?.avg_torque_nm, 'Nm', 1) },
      {
        id: 'peak_torque',
        group: 'Heart Rate & Cadence',
        label: 'Peak Torque',
        value: formatValue(activity?.peak_torque_nm, 'Nm', 1),
        hint: pbHint(torqueMaster1s, 'Nm'),
        badge: pbBadge(activity?.peak_torque_nm, torqueMaster1s),
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, hasFtp, powerCurve, speedHint, startTime, powerMaster5s, cadenceMaster1s, speedMaster5s, torqueMaster1s])

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

      {groups.map((group) => {
        const accent = GROUP_COLORS[group.name] || DEFAULT_GROUP_COLOR
        return (
          <div key={group.name} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {group.items.map((m) => (
              <MetricCard key={m.id} label={m.label} value={m.value} hint={m.hint} badge={m.badge} accent={accent} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
