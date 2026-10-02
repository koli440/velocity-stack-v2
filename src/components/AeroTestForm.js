'use client'

import { useMemo, useState } from 'react'
import { getAuthHeader } from '../lib/supabase'
import { parseJsonResponse } from '../lib/httpJson'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import {
  estimateStandardPressureHpa,
  calculateAirDensity,
  calculatePowerBreakdown,
  calculateCdA,
} from '../lib/aeroLab'

const CRR_OPTIONS = [0.0015, 0.002, 0.0025, 0.0033]

const inputClass =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500'
const labelClass = 'text-xs uppercase font-bold text-slate-400'

// "New Test" - migrated from v1's "💨 New Test" expander in pages/50_aero_lab.py. Collects
// position/equipment info, test environment and performance, computes CdA live with the Chung
// Method math (src/lib/aeroLab.js), then posts the result to /api/aero-tests.
export default function AeroTestForm({ tracks = [], onSaved }) {
  const [posName, setPosName] = useState('')
  const [bikeModel, setBikeModel] = useState('')
  const [helmet, setHelmet] = useState('')
  const [handlebars, setHandlebars] = useState('')
  const [notes, setNotes] = useState('')
  const [wRider, setWRider] = useState(75)
  const [wBike, setWBike] = useState(9.5)
  const [trackId, setTrackId] = useState('')
  const [showAdvancedEnv, setShowAdvancedEnv] = useState(false)
  const [tempC, setTempC] = useState(20)
  const [pressureOverride, setPressureOverride] = useState(null)
  const [humidity, setHumidity] = useState(50)
  const [speedKmh, setSpeedKmh] = useState(45)
  const [powerW, setPowerW] = useState(320)
  const [crr, setCrr] = useState(CRR_OPTIONS[1])
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  const selectedTrack = tracks.find((t) => t.id === trackId)
  const elevation = selectedTrack?.elevation_m || 0
  const standardPressure = useMemo(() => estimateStandardPressureHpa(elevation), [elevation])
  const pressureHpa = pressureOverride ?? Math.round(standardPressure * 10) / 10

  const airDensity = useMemo(
    () => calculateAirDensity(tempC, pressureHpa),
    [tempC, pressureHpa]
  )

  const totalWeight = (Number(wRider) || 0) + (Number(wBike) || 0)

  const cda = useMemo(
    () =>
      calculateCdA({
        speedKmh,
        powerW,
        totalWeightKg: totalWeight,
        crr,
        airDensity,
      }),
    [speedKmh, powerW, totalWeight, crr, airDensity]
  )

  const { powerAeroW, powerRollingW, powerDrivetrainW } = useMemo(
    () => calculatePowerBreakdown({ speedKmh, powerW, totalWeightKg: totalWeight, crr }),
    [speedKmh, powerW, totalWeight, crr]
  )

  const powerChartData = [
    { loss: 'Aero', watts: Math.max(powerAeroW, 0) },
    { loss: 'Rolling', watts: Math.max(powerRollingW, 0) },
    { loss: 'Drivetrain', watts: Math.max(powerDrivetrainW, 0) },
  ]

  const resetForm = () => {
    setPosName('')
    setBikeModel('')
    setHelmet('')
    setHandlebars('')
    setNotes('')
    setErrorMsg(null)
  }

  const handleSave = async () => {
    if (!posName) {
      setErrorMsg('Please enter a Position Name before saving.')
      return
    }

    setSaving(true)
    setErrorMsg(null)

    try {
      const authHeader = await getAuthHeader()
      const res = await fetch('/api/aero-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          positionName: posName,
          trackId: trackId || null,
          trackName: selectedTrack?.name || null,
          cda: Math.round(cda * 10000) / 10000,
          speedKmh,
          powerW,
          bike: bikeModel,
          helmet,
          handlebars,
          notes,
        }),
      })

      const json = await parseJsonResponse(res)
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to save test.')
      }

      resetForm()
      if (onSaved) onSaved(json.aeroTest)
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-5">
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-white">
        💨 New Test
      </h2>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-semibold">
          {errorMsg}
        </div>
      )}

      <div>
        <h3 className="text-xs uppercase font-bold text-slate-400 mb-2">Setup &amp; Equipment</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className={labelClass}>Position Name</span>
            <input
              type="text"
              value={posName}
              onChange={(e) => setPosName(e.target.value)}
              placeholder="e.g. Aero Baseline"
              className={inputClass}
            />
          </label>
          <label className="block space-y-1.5">
            <span className={labelClass}>Bike Model</span>
            <input
              type="text"
              value={bikeModel}
              onChange={(e) => setBikeModel(e.target.value)}
              placeholder="e.g. Argon 18 Electron Pro"
              className={inputClass}
            />
          </label>
          <label className="block space-y-1.5">
            <span className={labelClass}>Helmet</span>
            <input
              type="text"
              value={helmet}
              onChange={(e) => setHelmet(e.target.value)}
              placeholder="e.g. Giro Selector"
              className={inputClass}
            />
          </label>
          <label className="block space-y-1.5">
            <span className={labelClass}>Handlebars</span>
            <input
              type="text"
              value={handlebars}
              onChange={(e) => setHandlebars(e.target.value)}
              placeholder="e.g. WattShop Anemoi"
              className={inputClass}
            />
          </label>
        </div>
        <label className="block space-y-1.5 mt-4">
          <span className={labelClass}>Extra Details (Socks, Suit, etc.)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. Rule 28 socks, skin suit"
            className={inputClass}
          />
        </label>
      </div>

      <div>
        <h3 className="text-xs uppercase font-bold text-slate-400 mb-2">Weight Breakdown</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className={labelClass}>Rider Weight (kg)</span>
            <input
              type="number"
              min={40}
              max={130}
              step={0.5}
              value={wRider}
              onChange={(e) => setWRider(Number(e.target.value))}
              className={inputClass}
            />
          </label>
          <label className="block space-y-1.5">
            <span className={labelClass}>Equipment Weight (kg)</span>
            <input
              type="number"
              min={5}
              max={20}
              step={0.1}
              value={wBike}
              onChange={(e) => setWBike(Number(e.target.value))}
              className={inputClass}
            />
          </label>
        </div>
      </div>

      <div>
        <h3 className="text-xs uppercase font-bold text-slate-400 mb-2">Test Environment</h3>
        <label className="block space-y-1.5">
          <span className={labelClass}>Select Velodrome</span>
          <select
            value={trackId}
            onChange={(e) => {
              setTrackId(e.target.value)
              setPressureOverride(null)
            }}
            className={inputClass}
          >
            <option value="">Select a track...</option>
            {[...tracks]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>

        <details
          className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5"
          open={showAdvancedEnv}
          onToggle={(e) => setShowAdvancedEnv(e.target.open)}
        >
          <summary className="text-xs uppercase font-bold text-slate-400 cursor-pointer">
            🌍 Advanced Environment (Optional)
          </summary>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className={labelClass}>Air Temperature (°C)</span>
              <input
                type="number"
                step={0.1}
                value={tempC}
                onChange={(e) => setTempC(Number(e.target.value))}
                className={inputClass}
              />
            </label>
            <label className="block space-y-1.5">
              <span className={labelClass}>
                Air Pressure (hPa){' '}
                <span className="normal-case font-normal text-slate-400">
                  — standard sea-level pressure is 1013.25 hPa
                </span>
              </span>
              <input
                type="number"
                step={0.1}
                value={pressureHpa}
                onChange={(e) => setPressureOverride(Number(e.target.value))}
                className={inputClass}
              />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className={labelClass}>Relative Humidity ({humidity}%)</span>
              <input
                type="range"
                min={0}
                max={100}
                value={humidity}
                onChange={(e) => setHumidity(Number(e.target.value))}
                className="w-full"
              />
            </label>
          </div>
        </details>

        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          <span className="font-bold">Final Air Density (ρ):</span> {airDensity} kg/m³
        </p>
      </div>

      <div>
        <h3 className="text-xs uppercase font-bold text-slate-400 mb-2">Test Performance</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className={labelClass}>Avg Speed (km/h)</span>
            <input
              type="number"
              min={10}
              max={80}
              step={0.1}
              value={speedKmh}
              onChange={(e) => setSpeedKmh(Number(e.target.value))}
              className={inputClass}
            />
          </label>
          <label className="block space-y-1.5">
            <span className={labelClass}>Avg Power (Watts)</span>
            <input
              type="number"
              min={50}
              max={2000}
              step={5}
              value={powerW}
              onChange={(e) => setPowerW(Number(e.target.value))}
              className={inputClass}
            />
          </label>
        </div>
        <label className="block space-y-1.5 mt-4 max-w-xs">
          <span className={labelClass}>Rolling Resistance (Crr)</span>
          <select value={crr} onChange={(e) => setCrr(Number(e.target.value))} className={inputClass}>
            {CRR_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-4">
        <h3 className="text-xs uppercase font-bold text-slate-400">Aero Results</h3>
        {cda > 0 ? (
          <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 inline-block">
            <span className={labelClass}>Your CdA</span>
            <div className="text-2xl font-black text-emerald-600 dark:text-brand-neon">
              {cda.toFixed(3)} m²
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-semibold">
            Check inputs. Power too low for speed.
          </div>
        )}

        {cda > 0 && (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={powerChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="loss" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} label={{ value: 'Watts', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="watts" fill="#FF4B4B" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg transition active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? 'Saving...' : '💾 Save Test to Database'}
        </button>
      </div>
    </div>
  )
}
