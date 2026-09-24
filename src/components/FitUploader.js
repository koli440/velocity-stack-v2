'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

export default function FitUploader({ tracks = [], currentUser = null, onClose, onSaved }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [activeMetric, setActiveMetric] = useState('Cadence')

  // Metadata pro uložení jízdy
  const [title, setTitle] = useState('Velodrome Flying Laps')
  const [selectedTrack, setSelectedTrack] = useState(tracks[0]?.id || '')
  const [chainring, setChainring] = useState('58')
  const [cog, setCog] = useState('14')

  // Barevná mapa pro severský styl (Nordic Track)
  const metricColors = {
    Cadence: {
      stroke: '#F97316', // Nordic Orange
      badge: 'text-nordic-orange bg-orange-500/10 border-orange-500/30',
      activeTab: 'bg-nordic-orange text-white',
    },
    Speed: {
      stroke: '#38BDF8', // Nordic Cyan
      badge: 'text-nordic-cyan bg-sky-500/10 border-sky-500/30',
      activeTab: 'bg-nordic-cyan text-slate-900',
    },
    Power: {
      stroke: '#A78BFA', // Nordic Purple
      badge: 'text-nordic-purple bg-purple-500/10 border-purple-500/30',
      activeTab: 'bg-nordic-purple text-white',
    },
    Torque: {
      stroke: '#34D399', // Nordic Emerald
      badge: 'text-nordic-emerald bg-emerald-500/10 border-emerald-500/30',
      activeTab: 'bg-nordic-emerald text-slate-900',
    },
    HeartRate: {
      stroke: '#FB7185', // Rose / Red
      badge: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
      activeTab: 'bg-rose-500 text-white',
    },
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (res.ok) {
        setAnalysis(data)
        // Pokud přišla data a aktivní metrika v nich není, nastavíme první dostupnou
        if (data.curves && !data.curves[activeMetric]) {
          const firstKey = Object.keys(data.curves)[0]
          if (firstKey) setActiveMetric(firstKey)
        }
      } else {
        alert(data.error || 'Upload failed')
      }
    } catch (err) {
      alert('Error parsing FIT file: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!analysis) return
    setSaving(true)

    try {
      const res = await fetch('/api/activities/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          user_id: currentUser?.id || null,
          track_id: selectedTrack || null,
          chainring,
          cog,
          crank_length_mm: 165.0,
          summary: analysis.summary,
          curves: analysis.curves,
        }),
      })

      const text = await res.text()
      let result
      try {
        result = JSON.parse(text)
      } catch (parseErr) {
        throw new Error(
          `Server returned status ${res.status}: ${text.substring(0, 100)}`
        )
      }

      if (res.ok && result.success) {
        alert('🎉 Session successfully stored in your Track Feed!')
        setAnalysis(null)
        if (onSaved) onSaved()
        else router.refresh()
      }
    } catch (err) {
      alert('Error saving activity: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // Příprava dat křivky pro Recharts
  const chartData = analysis?.curves?.[activeMetric]
    ? Object.entries(analysis.curves[activeMetric]).map(([label, value]) => ({
        interval: label,
        value: value,
      }))
    : []

  const currentStroke = metricColors[activeMetric]?.stroke || '#F97316'

  return (
  <div className="bg-white dark:bg-surface-darkCard p-6 md:p-8 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-2xl relative">
    {onClose && (
      <button
        onClick={onClose}
        className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg font-bold p-1 rounded-lg"
      >
        ✕
      </button>
    )}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <h2 className="text-xl font-bold tracking-tight text-white">
              Track Telemetry Analyzer
            </h2>
          </div>
          <p className="text-nordic-muted text-xs md:text-sm mt-0.5">
            Process raw .FIT telemetry files directly to generate pure durational curves.
          </p>
        </div>

        <label className="relative inline-flex items-center justify-center bg-nordic-orange hover:bg-orange-600 text-white font-bold text-xs uppercase tracking-wider py-3 px-6 rounded-xl cursor-pointer transition shadow-nordic-glow">
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin"></span>
              Analyzing FIT...
            </span>
          ) : (
            '+ Select .FIT File'
          )}
          <input
            type="file"
            accept=".fit"
            onChange={handleUpload}
            disabled={loading}
            className="hidden"
          />
        </label>
      </div>

      {analysis && (
        <div className="space-y-6 pt-2">
          {/* KPI karty z analýzy */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800/80">
              <div className="text-[11px] uppercase tracking-wider text-nordic-muted">
                Peak Cadence
              </div>
              <div className="text-2xl font-extrabold text-nordic-orange mt-1">
                {analysis.summary.max_cadence ?? '-'} <span className="text-xs font-normal text-slate-400">RPM</span>
              </div>
            </div>

            <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800/80">
              <div className="text-[11px] uppercase tracking-wider text-nordic-muted">
                Max Speed
              </div>
              <div className="text-2xl font-extrabold text-nordic-cyan mt-1">
                {analysis.summary.max_speed_kmh ?? '-'} <span className="text-xs font-normal text-slate-400">km/h</span>
              </div>
            </div>

            <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800/80">
              <div className="text-[11px] uppercase tracking-wider text-nordic-muted">
                Max Power
              </div>
              <div className="text-2xl font-extrabold text-nordic-purple mt-1">
                {analysis.summary.max_power_w ?? '-'} <span className="text-xs font-normal text-slate-400">W</span>
              </div>
            </div>

            <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800/80">
              <div className="text-[11px] uppercase tracking-wider text-nordic-muted">
                Peak Torque
              </div>
              <div className="text-2xl font-extrabold text-nordic-emerald mt-1">
                {analysis.summary.peak_torque_nm ?? '-'} <span className="text-xs font-normal text-slate-400">Nm</span>
              </div>
            </div>
          </div>

          {/* Přepínač křivek v pill stylu */}
          <div className="flex flex-wrap gap-2 border-b border-nordic-border pb-3 pt-2">
            {Object.keys(analysis.curves).map((metric) => {
              const isActive = activeMetric === metric
              const tabStyle = metricColors[metric]?.activeTab || 'bg-nordic-orange text-white'

              return (
                <button
                  key={metric}
                  onClick={() => setActiveMetric(metric)}
                  className={`py-1.5 px-4 rounded-full text-xs font-semibold tracking-wide transition ${
                    isActive
                      ? `${tabStyle} shadow-sm`
                      : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {metric} Curve
                </button>
              )
            })}
          </div>

          {/* Graf křivek Recharts */}
          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                <XAxis dataKey="interval" stroke="#94A3B8" tick={{ fontSize: 12 }} />
                <YAxis stroke="#94A3B8" domain={['auto', 'auto']} tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    borderColor: 'rgba(51, 65, 85, 0.8)',
                    borderRadius: '0.75rem',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                    color: '#F8FAFC',
                    fontSize: '12px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={currentStroke}
                  strokeWidth={3}
                  dot={{ fill: currentStroke, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Panel pro uložení do databáze */}
          <div className="p-5 bg-slate-900/70 border border-nordic-border rounded-xl mt-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <span>💾</span> Tag & Save Workout to Feed
              </h3>
              {currentUser ? (
                <span className="text-xs text-nordic-emerald font-mono">
                  ✓ Ready as {currentUser.email}
                </span>
              ) : (
                <span className="text-xs text-amber-400/90 font-mono">
                  ⚠️ Guest session (login to store under your profile)
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-nordic-muted mb-1">
                  Session Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-nordic-orange"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-nordic-muted mb-1">
                  Velodrome
                </label>
                <select
                  value={selectedTrack}
                  onChange={(e) => setSelectedTrack(e.target.value)}
                  className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-nordic-orange"
                >
                  <option value="">-- Select Velodrome --</option>
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.length_m} m)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-nordic-muted mb-1">
                  Chainring (T)
                </label>
                <input
                  type="number"
                  value={chainring}
                  onChange={(e) => setChainring(e.target.value)}
                  placeholder="58"
                  className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-nordic-orange"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-nordic-muted mb-1">
                  Cog (T)
                </label>
                <input
                  type="number"
                  value={cog}
                  onChange={(e) => setCog(e.target.value)}
                  placeholder="14"
                  className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-nordic-orange"
                />
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl transition text-xs uppercase tracking-wider shadow-sm"
            >
              {saving ? 'Writing Telemetry to Vault...' : 'Save Workout to Track Vault'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
