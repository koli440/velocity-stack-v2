'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function FitUploader({ tracks = [], currentUser = null }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [activeMetric, setActiveMetric] = useState('Cadence')

  // Metadata k uložení
  const [title, setTitle] = useState('Velodrome Flying Laps')
  const [selectedTrack, setSelectedTrack] = useState(tracks[0]?.id || '')
  const [chainring, setChainring] = useState('58')
  const [cog, setCog] = useState('14')

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
          curves: analysis.curves
        })
      })
      
      const result = await res.json()
      if (res.ok) {
        alert('🎉 Activity successfully saved to your Track Feed!')
        setAnalysis(null) // vyčistit formulář
        router.refresh()  // obnovit data na stránce
      } else {
        alert('Save failed: ' + result.error)
      }
    } catch (err) {
      alert('Error saving activity: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const chartData = analysis?.curves?.[activeMetric]
    ? Object.entries(analysis.curves[activeMetric]).map(([label, value]) => ({
        interval: label,
        value: value,
      }))
    : []

  return (
    <div className="bg-track-card p-6 rounded-lg border border-track-line mb-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">⚡ Track Telemetry Analyzer</h2>
          <p className="text-slate-400 text-sm">Upload raw .FIT file to calculate pure neuromuscular curves.</p>
        </div>
        <label className="bg-track-orange hover:bg-orange-600 text-white font-bold py-2 px-5 rounded cursor-pointer transition">
          {loading ? 'Analyzing Telemetry...' : '+ Choose .FIT File'}
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
        <div className="space-y-6">
          {/* Špičky a souhrn */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-900 rounded border border-slate-800 text-center">
            <div>
              <div className="text-xs text-slate-400">Peak Cadence</div>
              <div className="text-2xl font-bold text-orange-400">{analysis.summary.max_cadence ?? '-'} RPM</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Max Speed</div>
              <div className="text-2xl font-bold text-sky-400">{analysis.summary.max_speed_kmh ?? '-'} km/h</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Max Power</div>
              <div className="text-2xl font-bold text-purple-400">{analysis.summary.max_power_w ?? '-'} W</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Peak Torque</div>
              <div className="text-2xl font-bold text-emerald-400">{analysis.summary.peak_torque_nm ?? '-'} Nm</div>
            </div>
          </div>

          {/* Přepínač křivek */}
          <div className="flex gap-2 border-b border-slate-700 pb-2">
            {Object.keys(analysis.curves).map((metric) => (
              <button
                key={metric}
                onClick={() => setActiveMetric(metric)}
                className={`py-1 px-4 rounded text-sm font-semibold transition ${
                  activeMetric === metric
                    ? 'bg-track-orange text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {metric} Curve
              </button>
            ))}
          </div>

          {/* Vykreslení grafu */}
          <div className="h-72 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="interval" stroke="#94A3B8" />
                <YAxis stroke="#94A3B8" domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', color: '#F8FAFC' }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#FF5722"
                  strokeWidth={3}
                  dot={{ fill: '#FF5722', r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Dráhový panel pro uložení do databáze */}
          <div className="p-4 bg-slate-900 border border-slate-700 rounded-lg">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-3">
              🏁 Tag & Save to Track Feed
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Session Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-white focus:outline-none focus:border-track-orange"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Velodrome</label>
                <select
                  value={selectedTrack}
                  onChange={(e) => setSelectedTrack(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-white focus:outline-none focus:border-track-orange"
                >
                  <option value="">-- Select Velodrome --</option>
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.length_m}m)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Chainring (Teeth)</label>
                <input
                  type="number"
                  value={chainring}
                  onChange={(e) => setChainring(e.target.value)}
                  placeholder="58"
                  className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-white focus:outline-none focus:border-track-orange"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Cog (Teeth)</label>
                <input
                  type="number"
                  value={cog}
                  onChange={(e) => setCog(e.target.value)}
                  placeholder="14"
                  className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-white focus:outline-none focus:border-track-orange"
                />
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 rounded transition text-sm"
            >
              {saving ? 'Saving to Database...' : '💾 Save Workout to Track Vault'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
