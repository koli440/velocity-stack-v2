'use client'

// Kompletní sada metrik aktivity (issue #11): čas, vzdálenost, výkon (vč. průměrů v různých
// oknech), tepová frekvence, kadence, točivý moment, převýšení a zátěžové ukazatele.

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
    <div className="p-3.5 rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder space-y-1">
      <span className="text-[10px] uppercase font-bold text-slate-400 block">{label}</span>
      <div className="text-lg font-black text-slate-900 dark:text-white">{value}</div>
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
  if (!activity) return null

  const powerCurve = curvesMap?.Power || {}
  const powerWindows = ['15s', '30s', '1m', '5m', '15m', '30m']

  const startTime = activity.start_time || activity.activity_date
  const hasFtp = activity.intensity_factor != null && activity.training_load != null
  const speedHint = speedSourceHint(activity.speed_source)

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
        <span>📊</span> Activity Metrics
      </h3>

      {/* Čas, vzdálenost a rychlost */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Start Time"
          value={startTime ? new Date(startTime).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'}
        />
        <MetricCard label="Distance" value={formatDistance(activity.distance_m)} hint={speedHint} />
        <MetricCard label="Moving Time" value={formatDuration(activity.moving_time_s)} hint={speedHint} />
        <MetricCard label="Elapsed Time" value={formatDuration(activity.elapsed_time_s)} />
        <MetricCard label="Avg Speed" value={formatValue(activity.avg_speed_kmh, 'km/h', 1)} hint={speedHint} />
        <MetricCard label="Max Speed" value={formatValue(activity.max_speed_kmh, 'km/h', 1)} hint={speedHint} />
      </div>

      {/* Výkon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Avg Power" value={formatValue(activity.avg_power_w, 'W')} />
        <MetricCard label="Normalized Power" value={formatValue(activity.normalized_power_w, 'W')} />
        <MetricCard label="Peak Power" value={formatValue(activity.max_power_w, 'W')} />
        {powerWindows.map((win) => (
          <MetricCard key={win} label={`Avg Power @${win}`} value={formatValue(powerCurve[win], 'W')} />
        ))}
      </div>

      {/* Zátěž a intenzita */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Intensity Factor"
          value={hasFtp ? activity.intensity_factor.toFixed(2) : '—'}
          hint={!hasFtp ? 'Set FTP in profile' : undefined}
        />
        <MetricCard
          label="Training Load"
          value={hasFtp ? Math.round(activity.training_load) : '—'}
          hint={!hasFtp ? 'Set FTP in profile' : undefined}
        />
        <MetricCard label="Elevation Gain" value={formatValue(activity.elevation_gain_m, 'm')} />
        <MetricCard label="Elevation Loss" value={formatValue(activity.elevation_loss_m, 'm')} />
      </div>

      {/* Tepová frekvence, kadence, točivý moment */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Avg HR" value={formatValue(activity.avg_hr, 'bpm')} />
        <MetricCard label="Max HR" value={formatValue(activity.max_hr, 'bpm')} />
        <MetricCard label="Avg Cadence" value={formatValue(activity.avg_cadence_rpm, 'RPM')} />
        <MetricCard label="Max Cadence" value={formatValue(activity.max_cadence_rpm, 'RPM')} />
        <MetricCard label="Avg Torque" value={formatValue(activity.avg_torque_nm, 'Nm', 1)} />
        <MetricCard label="Peak Torque" value={formatValue(activity.peak_torque_nm, 'Nm', 1)} />
      </div>
    </div>
  )
}
