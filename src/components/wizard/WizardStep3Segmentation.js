'use client'

import { useState, useEffect } from 'react'
import { detectEffortsByCadence, detectEffortsByTorque } from '../../lib/effortDetection'

export default function WizardStep3Segmentation({
  formData,
  setFormData,
  streams = {},
  laps = [],
}) {
  const [detectionMode, setDetectionMode] = useState('cadence') // 'laps' | 'cadence' | 'torque' | 'full'
  const [minRpm, setMinRpm] = useState(125)
  const [minTorque, setMinTorque] = useState(65)
  const [detectedList, setDetectedList] = useState(formData.detected_efforts || [])

  // Spuštění detekce při změně parametrů
  useEffect(() => {
    let results = []

    if (detectionMode === 'laps' && laps && laps.length > 0) {
      results = laps.map((lap, idx) => ({
        id: `lap_${idx}`,
        start_sec: lap.start_index || lap.start_time || 0,
        end_sec: lap.end_index || (lap.start_time + lap.total_timer_time) || 0,
        duration_sec: Math.round(lap.total_timer_time || 0),
        max_cadence: lap.max_cadence || null,
        max_power: lap.max_power || null,
        max_speed: lap.max_speed ? Math.round(lap.max_speed * 3.6 * 10) / 10 : null,
        type: `Lap ${idx + 1}`,
      }))
    } else if (detectionMode === 'cadence') {
      results = detectEffortsByCadence(
        streams.cadence || [],
        streams.watts || [],
        streams.velocity_smooth || [],
        minRpm,
        5
      )
    } else if (detectionMode === 'torque') {
      results = detectEffortsByTorque(
        streams.torque || [],
        streams.cadence || [],
        minTorque,
        3
      )
    } else if (detectionMode === 'full') {
      results = [
        {
          id: 'full_session',
          start_sec: 0,
          end_sec: streams.cadence?.length || 0,
          duration_sec: streams.cadence?.length || 0,
          max_cadence: streams.cadence ? Math.max(...streams.cadence) : null,
          max_power: streams.watts ? Math.max(...streams.watts) : null,
          type: 'Celá jízda (Hladký závod / Workout)',
        },
      ]
    }

    setDetectedList(results)
    setFormData((prev) => ({
      ...prev,
      segmentation_mode: detectionMode,
      detected_efforts: results,
    }))
  }, [detectionMode, minRpm, minTorque, streams, laps])

  // Možnost odebrat nerelevantní úsek (např. falešnou detekci při rozjíždění)
  const handleRemoveEffort = (id) => {
    const filtered = detectedList.filter((e) => e.id !== id)
    setDetectedList(filtered)
    setFormData((prev) => ({ ...prev, detected_efforts: filtered }))
  }

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 1. Volba metody detekce */}
      <div>
        <label className="block text-[11px] uppercase font-bold text-slate-400 mb-2">
          Způsob detekce ostrých úseků (Effort Segmentation)
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setDetectionMode('cadence')}
            className={`p-3 rounded-2xl border text-left transition flex flex-col justify-between ${
              detectionMode === 'cadence'
                ? 'border-orange-500 bg-orange-500/10 text-orange-500 ring-2 ring-orange-500/20 shadow-sm'
                : 'border-slate-200 dark:border-surface-darkBorder bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300'
            }`}
          >
            <span className="text-xl mb-1">⚡</span>
            <div>
              <div className="text-xs font-black">Kadence &gt; {minRpm} RPM</div>
              <div className="text-[10px] text-slate-400">Letmé sprinty & F200</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setDetectionMode('torque')}
            className={`p-3 rounded-2xl border text-left transition flex flex-col justify-between ${
              detectionMode === 'torque'
                ? 'border-orange-500 bg-orange-500/10 text-orange-500 ring-2 ring-orange-500/20 shadow-sm'
                : 'border-slate-200 dark:border-surface-darkBorder bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300'
            }`}
          >
            <span className="text-xl mb-1">🦾</span>
            <div>
              <div className="text-xs font-black">Torque &gt; {minTorque} Nm</div>
              <div className="text-[10px] text-slate-400">Pevné starty & Kilo</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setDetectionMode('laps')}
            className={`p-3 rounded-2xl border text-left transition flex flex-col justify-between ${
              detectionMode === 'laps'
                ? 'border-orange-500 bg-orange-500/10 text-orange-500 ring-2 ring-orange-500/20 shadow-sm'
                : 'border-slate-200 dark:border-surface-darkBorder bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300'
            }`}
          >
            <span className="text-xl mb-1">🔘</span>
            <div>
              <div className="text-xs font-black">Lap Tlačítko</div>
              <div className="text-[10px] text-slate-400">Podle mezičasů</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setDetectionMode('full')}
            className={`p-3 rounded-2xl border text-left transition flex flex-col justify-between ${
              detectionMode === 'full'
                ? 'border-orange-500 bg-orange-500/10 text-orange-500 ring-2 ring-orange-500/20 shadow-sm'
                : 'border-slate-200 dark:border-surface-darkBorder bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300'
            }`}
          >
            <span className="text-xl mb-1">🏁</span>
            <div>
              <div className="text-xs font-black">Celý záznam</div>
              <div className="text-[10px] text-slate-400">Scratch, Body, Souvislá jízda</div>
            </div>
          </button>
        </div>
      </div>

      {/* 2. Nastavení citlivosti detektoru */}
      {detectionMode === 'cadence' && (
        <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400">Práh kadence pro ostrý úsek:</span>
          <div className="flex items-center gap-2">
            {[115, 120, 125, 130, 135].map((rpm) => (
              <button
                key={rpm}
                type="button"
                onClick={() => setMinRpm(rpm)}
                className={`py-1 px-2.5 rounded-lg text-xs font-bold ${
                  minRpm === rpm ? 'bg-orange-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-400'
                }`}
              >
                {rpm} RPM
              </button>
            ))}
          </div>
        </div>
      )}

      {detectionMode === 'torque' && (
        <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400">Práh točivého momentu pro pevný start:</span>
          <div className="flex items-center gap-2">
            {[50, 60, 65, 75, 85].map((trq) => (
              <button
                key={trq}
                type="button"
                onClick={() => setMinTorque(trq)}
                className={`py-1 px-2.5 rounded-lg text-xs font-bold ${
                  minTorque === trq ? 'bg-orange-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-400'
                }`}
              >
                {trq} Nm
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 3. Seznam nalezených úseků (Interactive Preview) */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-[11px] uppercase font-bold text-slate-400">
            Detekované úseky ({detectedList.length})
          </label>
          <span className="text-[10px] text-slate-400">Nechtěné můžeš křížkem smazat</span>
        </div>

        {detectedList.length === 0 ? (
          <div className="text-center py-8 rounded-2xl bg-slate-50 dark:bg-slate-900/40 border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400">
            Při tomto nastavení nebyl nalezen žádný úsek. Zkus snížit práh nebo přepnout na celou jízdu.
          </div>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {detectedList.map((eff, index) => (
              <div
                key={eff.id || index}
                className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono font-bold text-slate-400">#{index + 1}</span>
                  <div>
                    <div className="text-xs font-black text-slate-900 dark:text-white">
                      {eff.type} ({eff.duration_sec}s)
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {formatTime(eff.start_sec)} – {formatTime(eff.end_sec)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {eff.max_cadence && (
                    <div className="text-right">
                      <div className="text-[9px] uppercase font-bold text-slate-400">Max Kadence</div>
                      <div className="text-xs font-black text-orange-500">{eff.max_cadence} RPM</div>
                    </div>
                  )}

                  {eff.peak_torque && (
                    <div className="text-right">
                      <div className="text-[9px] uppercase font-bold text-slate-400">Peak Torque</div>
                      <div className="text-xs font-black text-amber-400">{eff.peak_torque} Nm</div>
                    </div>
                  )}

                  {eff.max_power && (
                    <div className="text-right">
                      <div className="text-[9px] uppercase font-bold text-slate-400">Max Watts</div>
                      <div className="text-xs font-black text-purple-400">{eff.max_power} W</div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => handleRemoveEffort(eff.id)}
                    className="p-1 text-slate-400 hover:text-rose-500 text-xs font-bold transition ml-2"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}