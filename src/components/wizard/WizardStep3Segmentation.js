'use client'

import { useState, useEffect } from 'react'
import { analyzeSessionEfforts } from '../../lib/effortDetectionEngine'

export default function WizardStep3Segmentation({
  formData,
  setFormData,
  activity = {},
}) {
  const timeSeries = activity?.time_series || {}
  const [efforts, setEfforts] = useState(formData.detected_efforts || [])
  const [selectedDistance, setSelectedDistance] = useState(3000)
  const [analyzed, setAnalyzed] = useState(false)
  const [engineMessage, setEngineMessage] = useState(null)

  // Automatické spuštění detekce při načtení kroku
  useEffect(() => {
    // Pokud už máme uložené dříve schválené úseky a odpovídají dané disciplíně
    if (formData.detected_efforts && formData.detected_efforts.length > 0 && !analyzed) {
      setEfforts(formData.detected_efforts)
      const first = formData.detected_efforts[0]
      if (first.suggested_distance_m) {
        setSelectedDistance(first.suggested_distance_m)
      }
      setAnalyzed(true)
      return
    }

    // Spuštění univerzálního detektoru
    const result = analyzeSessionEfforts({
      discipline: formData.discipline || 'individual_pursuit',
      timeSeries,
    })

    if (result.message) {
      setEngineMessage(result.message)
    } else {
      setEngineMessage(null)
    }

    if (result.efforts && result.efforts.length > 0) {
      const first = result.efforts[0]
      const dist = first.suggested_distance_m || 3000
      setSelectedDistance(dist)
      setEfforts(result.efforts)
      setFormData((prev) => ({ ...prev, detected_efforts: result.efforts }))
    } else {
      setEfforts([])
    }
    setAnalyzed(true)
  }, [formData.discipline, timeSeries, analyzed, formData.detected_efforts, setFormData])

  // Změna vzdálenosti u stíhačky (2km / 3km / 4km)
  const handleDistanceChange = (distMeters) => {
    setSelectedDistance(distMeters)
    const updated = efforts.map((eff) => {
      const duration = eff.duration_sec || 1
      const speed = Math.round(((distMeters / duration) * 3.6) * 10) / 10
      const lapTime = (duration / (distMeters / 250)).toFixed(2)
      return {
        ...eff,
        suggested_distance_m: distMeters,
        discipline_label: `${distMeters / 1000} km Stíhačka`,
        calculated_speed_kmh: speed,
        lap_time_250m: lapTime,
      }
    })
    setEfforts(updated)
    setFormData((prev) => ({ ...prev, detected_efforts: updated }))
  }

  const formatTime = (sec) => {
    if (!sec && sec !== 0) return '0:00'
    const m = Math.floor(sec / 60)
    const s = Math.round(sec % 60)
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  const isPursuit =
    formData.discipline === 'individual_pursuit' ||
    formData.discipline === 'team_pursuit'

  const pursuitEffort = efforts[0] || null

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
            Segmentace & Detekce úseků
          </h3>
          <span className="text-[10px] font-mono py-0.5 px-2 rounded bg-orange-500/10 text-orange-500 font-bold border border-orange-500/20 uppercase">
            {formData.discipline || 'Track Effort'}
          </span>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          Analýza sekundových wattů a kadence pro vybranou disciplínu.
        </p>
      </div>

      {/* 1. KDYŽ JDE O STÍHAČKU A MÁME NALEZENÝ ÚSEK */}
      {isPursuit && pursuitEffort && (
        <div className="p-5 rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">⏱️</span>
              <div>
                <div className="text-xs font-black text-slate-900 dark:text-white">
                  Detekován souvislý závodní tah stíhačky
                </div>
                <div className="text-[11px] text-slate-400">
                  Čas úseku:{' '}
                  <span className="font-extrabold text-orange-500 font-mono text-xs">
                    {formatTime(pursuitEffort.duration_sec)}
                  </span>{' '}
                  ({formatTime(pursuitEffort.start_sec)} – {formatTime(pursuitEffort.end_sec)})
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-black text-orange-500 font-mono">
                {pursuitEffort.avg_power || '—'} W
              </div>
              <div className="text-[9px] uppercase font-bold text-slate-400">Průměrný výkon</div>
            </div>
          </div>

          {/* Přepínač vzdálenosti ke schválení */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-2">
              Potvrďte délku stíhacího závodu:
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[2000, 3000, 4000].map((dist) => {
                const isSelected = selectedDistance === dist
                return (
                  <button
                    key={dist}
                    type="button"
                    onClick={() => handleDistanceChange(dist)}
                    className={`py-3 px-2 rounded-2xl border text-center transition flex flex-col items-center justify-center ${
                      isSelected
                        ? 'border-orange-500 bg-orange-500/10 text-orange-500 ring-2 ring-orange-500/20 shadow-xs'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-500 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <span className="text-xs font-black">{dist / 1000} km</span>
                    <span className="text-[9px] text-slate-400 font-semibold mt-0.5">
                      {dist === 3000
                        ? 'Masters doporučeno'
                        : dist === 2000
                        ? 'Ženy / Junioři'
                        : 'Elite Muži'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Vypočtené výsledky z délky a naměřeného času */}
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-200/60 dark:border-slate-800 text-center">
            <div>
              <div className="text-[9px] uppercase font-bold text-slate-400">Odvozená rychlost</div>
              <div className="text-sm font-extrabold text-sky-400 font-mono">
                {pursuitEffort.calculated_speed_kmh} km/h
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase font-bold text-slate-400">Průměr na 250m kolo</div>
              <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100 font-mono">
                {pursuitEffort.lap_time_250m} s
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase font-bold text-slate-400">Průměrná kadence</div>
              <div className="text-sm font-extrabold text-orange-500 font-mono">
                {pursuitEffort.avg_cadence ? `${pursuitEffort.avg_cadence} RPM` : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. PRO OSTATNÍ DISCIPLÍNY NEBO DETEKOVANÉ INTERVALY */}
      {!isPursuit && efforts.length > 0 && (
        <div className="space-y-2">
          {efforts.map((eff, idx) => (
            <div
              key={eff.id || idx}
              className="flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs"
            >
              <div>
                <div className="text-xs font-black text-slate-900 dark:text-white">
                  #{idx + 1} {eff.discipline_label || 'Úsek'} ({eff.duration_sec}s)
                </div>
                <div className="text-[10px] text-slate-400 font-mono">
                  Čas: {formatTime(eff.start_sec)} – {formatTime(eff.end_sec)}
                </div>
              </div>

              <div className="flex items-center gap-4 text-right">
                {eff.max_cadence && (
                  <div>
                    <div className="text-[8px] uppercase font-bold text-slate-400">Max RPM</div>
                    <div className="text-xs font-black text-orange-500">{eff.max_cadence}</div>
                  </div>
                )}
                {eff.avg_power && (
                  <div>
                    <div className="text-[8px] uppercase font-bold text-slate-400">Průměr W</div>
                    <div className="text-xs font-black text-purple-400">{eff.avg_power} W</div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3. STAV, KDY NENÍ NALEZEN ŽÁDNÝ ÚSEK (CHYBÍ TIME_SERIES V DB) */}
      {efforts.length === 0 && (
        <div className="p-6 rounded-3xl bg-slate-50 dark:bg-slate-900/40 border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-2">
          <div className="text-2xl">🔍</div>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
            Nebyly nalezeny žádné souvislé úseky pro disciplínu „{formData.discipline}“
          </div>
          <p className="text-[11px] text-slate-400 max-w-md mx-auto">
            {engineMessage ||
              'Aktivita zřejmě neobsahuje vteřinová data wattů/kadence (time_series), nebo byla synchronizována před aktualizací importu.'}
          </p>
        </div>
      )}
    </div>
  )
}